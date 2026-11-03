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
  type CompiledWorkflowCatalog,
  type ResolvedTaskCard,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { queryOptions, type QueryClient, type QueryKey } from "@tanstack/react-query";
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

/** The board, workflows, and creation workflow of one workspace. The host checks the inventory. */
export type WorkspaceWorkflows = {
  readonly catalog: CompiledWorkflowCatalog;
  readonly context: WorkspaceWorkflowContext;
  readonly workflows: readonly TaskWorkflow[];
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
    newTaskWorkflow: requireCatalogWorkflow(catalog, context.newTaskWorkflow),
  };
};

/** The host resolves and checks the board; the client checks it against the same catalog read. */
export const workspaceWorkflowQueryOptions = (scope: WorkspaceRef) =>
  queryOptions<WorkspaceWorkflows, Error, WorkspaceWorkflows, QueryKey>({
    queryKey: workflowQueryKeys.workspace(scope),
    queryFn: async ({ client }) => {
      const [catalog, context] = await Promise.all([
        client.ensureQueryData(workflowCatalogQueryOptions()),
        connectionHost(client).workspaceWorkflowGet(scope),
      ]);
      return workspaceWorkflows(catalog, workspaceWorkflowContextSchema.parse(context));
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

export const resolveTaskCards = async (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  cards: readonly TaskCard[] | Promise<readonly TaskCard[]>,
): Promise<ResolvedTaskCard[]> => {
  const [workspace, loadedCards] = await Promise.all([
    // An invalidated workspace read refetches here, so recovery never joins an old catalog.
    queryClient.fetchQuery(workspaceWorkflowQueryOptions(scope)),
    cards,
  ]);
  return resolveWorkflowTaskCards(workspace.catalog, workspace.context, loadedCards);
};

/** The existing connection recovery barrier calls this before task views reopen. */
export const refreshWorkflowMetadata = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: workflowQueryKeys.all });
  await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all, refetchType: "none" });
  await queryClient.fetchQuery({ ...workflowCatalogQueryOptions(), staleTime: 0 });
  // Workspace reads belong to their task recovery, so one failed board cannot block others.
};
