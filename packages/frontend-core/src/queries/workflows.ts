import {
  type WorkspaceRef,
  workspaceWorkflowContextSchema,
  type TaskCard,
  type WorkspaceWorkflowContext,
} from "@openducktor/contracts";
import {
  compileWorkflowCatalog,
  requireCatalogWorkflow,
  resolveWorkflowTaskCards,
  workflowReferenceKey,
  type CompiledWorkflowCatalog,
  type ResolvedTaskCard,
  type TaskWorkflow,
} from "@openducktor/workflows";
import {
  queryOptions,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { skippedQueryOptions } from "./skipped-query";
import { workspaceScopeValue } from "./workspace-scope";
import { connectionHost } from "../connection/client-connection";

export const workflowQueryKeys = {
  all: ["workflows"] as const,
  catalog: ["workflows", "catalog"] as const,
  workspace: (scope: WorkspaceRef) =>
    ["workflows", "workspace", workspaceScopeValue(scope)] as const,
  skipped: ["workflows", "skipped"] as const,
};

/** The host catalog. Each definition compiles once per catalog read. */
export const workflowCatalogQueryOptions = () =>
  queryOptions({
    queryKey: workflowQueryKeys.catalog,
    queryFn: async ({ client }) => {
      try {
        return compileWorkflowCatalog(await connectionHost(client).workflowCatalogGet());
      } catch (cause) {
        throw new Error(
          `Workflow catalog could not load. Check the host connection and version, then restart the host and refresh tasks. ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    },
    staleTime: Infinity,
  });

/** The board, workflows, and creation workflows of one workspace. The host checks the inventory. */
export type WorkspaceWorkflows = {
  readonly catalog: CompiledWorkflowCatalog;
  readonly context: WorkspaceWorkflowContext;
  readonly workflows: readonly TaskWorkflow[];
  /** The latest version of each enabled workflow. The default comes first. */
  readonly newTaskWorkflows: readonly TaskWorkflow[];
  /** The default workflow for new tasks. */
  readonly newTaskWorkflow: TaskWorkflow;
};

export const workspaceWorkflows = (
  catalog: CompiledWorkflowCatalog,
  context: WorkspaceWorkflowContext,
): WorkspaceWorkflows => {
  if (catalog.hostInstanceId !== context.hostInstanceId)
    throw new Error(
      `Workflow catalog belongs to host "${catalog.hostInstanceId}", but the board belongs to "${context.hostInstanceId}". Reconnect before continuing.`,
    );
  return {
    catalog,
    context,
    workflows: context.workflows.map((reference) => requireCatalogWorkflow(catalog, reference)),
    newTaskWorkflows: context.newTaskWorkflows.map((reference) =>
      requireCatalogWorkflow(catalog, reference),
    ),
    newTaskWorkflow: requireCatalogWorkflow(catalog, context.newTaskWorkflow),
  };
};

const contextReferences = (context: WorkspaceWorkflowContext) => [
  ...context.workflows,
  ...context.newTaskWorkflows,
  context.newTaskWorkflow,
];

/**
 * Starts a new read of a query. A read that is in progress may predate a host change, so it stops
 * and its waiters receive the new read.
 */
const fetchAgain = <T, K extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>,
): Promise<T> => {
  const defaulted = queryClient.defaultQueryOptions(options);
  return queryClient
    .getQueryCache()
    .build(queryClient, defaulted)
    .fetch(defaulted, { cancelRefetch: true });
};

/**
 * The host resolves and checks the board; the client checks it against the same catalog read.
 * Versions never change, so a cached catalog serves every version that it holds. A context that
 * names a version that the cached catalog lacks, such as a new publication, reads the catalog
 * again once.
 */
export const workspaceWorkflowQueryOptions = (scope: WorkspaceRef) =>
  queryOptions<WorkspaceWorkflows, Error, WorkspaceWorkflows, QueryKey>({
    queryKey: workflowQueryKeys.workspace(scope),
    queryFn: async ({ client }) => {
      const [cached, context] = await Promise.all([
        // A library change marks the catalog stale, so the next workspace read gets current roles.
        client.fetchQuery(workflowCatalogQueryOptions()),
        connectionHost(client)
          .workspaceWorkflowGet(scope)
          .then((read) => workspaceWorkflowContextSchema.parse(read)),
      ]);
      const complete = contextReferences(context).every((reference) =>
        cached.workflows.has(workflowReferenceKey(reference)),
      );
      const catalog = complete ? cached : await fetchAgain(client, workflowCatalogQueryOptions());
      return workspaceWorkflows(catalog, context);
    },
    staleTime: Infinity,
  });

/** The workspace read of a view, or the skipped read of a view without a workspace. */
export const optionalWorkspaceWorkflowQueryOptions = (scope: WorkspaceRef | null) =>
  scope
    ? workspaceWorkflowQueryOptions(scope)
    : skippedQueryOptions<WorkspaceWorkflows>({
        queryKey: workflowQueryKeys.skipped,
        staleTime: Infinity,
      });

/** Whether the cached workspace has the workflow version of each card. */
const knowsCards = (workspace: WorkspaceWorkflows, cards: readonly TaskCard[]) => {
  const known = new Set(workspace.context.workflows.map(workflowReferenceKey));
  return cards.every((card) => known.has(workflowReferenceKey(card.workflow)));
};

/**
 * Joins task cards to their workflows. A card can name a version that the cached workspace lacks,
 * such as a task that moved to a new version before the library event arrived. Then the workspace
 * and the catalog are read again once. A second miss fails.
 */
export const resolveTaskCards = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  cards: readonly TaskCard[] | Promise<readonly TaskCard[]>,
): Promise<ResolvedTaskCard[]> => {
  const [cached, loadedCards] = await Promise.all([
    // An invalidated workspace read refetches here, so recovery never joins an old catalog.
    queryClient.fetchQuery(workspaceWorkflowQueryOptions(scope)),
    cards,
  ]);
  const workspace = knowsCards(cached, loadedCards)
    ? cached
    : await fetchAgain(queryClient, workspaceWorkflowQueryOptions(scope));
  return resolveWorkflowTaskCards(workspace.catalog, workspace.context, loadedCards);
};

/**
 * The board has the columns of a version that new tasks cannot use only while a non-closed task
 * uses it. A task event that changes or removes a task of such a version can add or drop columns,
 * so the workspace read goes stale before the cards of the event join their workflows.
 */
export const staleBoardForHiddenVersions = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  tasks: readonly Pick<TaskCard, "workflow">[],
): Promise<void> => {
  const workspace = queryClient.getQueryData<WorkspaceWorkflows>(
    workflowQueryKeys.workspace(scope),
  );
  if (!workspace) return;
  const offered = new Set(workspace.context.newTaskWorkflows.map(workflowReferenceKey));
  if (tasks.every(({ workflow }) => offered.has(workflowReferenceKey(workflow)))) return;
  // The join reads the stale workspace once, so observers get that read too.
  await queryClient.invalidateQueries({
    queryKey: workflowQueryKeys.workspace(scope),
    exact: true,
    refetchType: "none",
  });
};

/** The existing connection recovery barrier calls this before task views reopen. */
export const refreshWorkflowMetadata = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: workflowQueryKeys.all });
  await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all, refetchType: "none" });
  await queryClient.fetchQuery({ ...workflowCatalogQueryOptions(), staleTime: 0 });
  // Workspace reads belong to their task recovery, so one failed board cannot block others.
};
