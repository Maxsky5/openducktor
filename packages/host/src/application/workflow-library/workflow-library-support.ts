import type {
  WorkflowDocument,
  WorkflowLibraryEntry,
  WorkflowLibraryState,
  workflowLibraryInputSchemas,
  WorkflowProblem,
  WorkflowTaskRef,
} from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  BUILTIN_WORKFLOW_ID,
  builtinWorkflowDocument,
  columnOrder,
  specPlanBuildWorkflow,
  versionToDocument,
  withBuiltinSharedFields,
  workflowIdFromName,
  type WorkflowCheckContext,
} from "@openducktor/workflows";
import { Effect } from "effect";
import type { z } from "zod";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type {
  StoredWorkflowRole,
  StoredWorkflowRow,
  StoredWorkflowVersion,
  WorkflowLibraryReads,
  WorkflowLibraryStoreError,
  WorkflowLibraryStorePort,
} from "../../ports/workflow-library-store-port";
import { roleCatalogOf } from "../tasks/task-workflows";
import { parseWorkflowFile } from "./workflow-file-codec";
import type { WorkflowImportHostState } from "./workflow-import-plan";
import type { RunningTaskSession, TaskMoveTarget } from "./workflow-task-moves";

export type WorkflowLibraryServiceError = HostError | WorkflowLibraryStoreError;

export type WorkflowLibraryServiceDeps = {
  readonly store: WorkflowLibraryStorePort;
  /** The agent sessions that run on this host, with the task and role of each. */
  readonly runningTaskSessions: () => Effect.Effect<readonly RunningTaskSession[], HostError>;
  /** Publishes the task changes of moved tasks on the task stream. */
  readonly publishMovedTasks: (tasks: readonly WorkflowTaskRef[]) => Effect.Effect<void, HostError>;
  /** Sends `openducktor://workflow-library-changed`. */
  readonly publishLibraryChanged: () => void;
};

/** The parsed inputs of the library commands. */
export type WorkflowLibraryCommandInputs = {
  [Command in keyof typeof workflowLibraryInputSchemas]: z.output<
    (typeof workflowLibraryInputSchemas)[Command]
  >;
};
export type Inputs = WorkflowLibraryCommandInputs;
export type Result<A> = Effect.Effect<A, WorkflowLibraryServiceError>;

export const invalid = (message: string, field = "workflow") =>
  new HostValidationError({ message, field });

export const errorCount = (problems: readonly WorkflowProblem[]) =>
  problems.filter(({ severity }) => severity === "error").length;

/** The errors and the warnings of a draft check, for the library list. */
export const draftCounts = (problems: readonly WorkflowProblem[]) => {
  const problemCount = errorCount(problems);
  return { problemCount, warningCount: problems.length - problemCount };
};

export const builtinName = specPlanBuildWorkflow.definition.label;
export const builtinRoleIds = new Set<string>(BUILTIN_ROLES.map(({ id }) => id));

const isDeleted = (workflows: readonly StoredWorkflowRow[], workflowId: string) =>
  workflows.some((row) => row.workflowId === workflowId && row.deletedAtMs !== null);

/** The check context of a draft, from the database state. */
export const checkContext = (
  workflowId: string,
  latestVersion: number | null,
  workflows: readonly StoredWorkflowRow[],
  latestVersions: readonly StoredWorkflowVersion[],
  customRoles: readonly StoredWorkflowRole[],
): WorkflowCheckContext => ({
  roles: roleCatalogOf(customRoles.map(({ role }) => role)),
  otherWorkflows: latestVersions
    .filter(
      (version) => version.workflowId !== workflowId && !isDeleted(workflows, version.workflowId),
    )
    .map(({ document }) => withBuiltinSharedFields(document.definition)),
  // The ID is fixed after the first publication. A deleted workflow keeps its ID.
  takenWorkflowIds:
    latestVersion === null
      ? new Set([
          BUILTIN_WORKFLOW_ID,
          ...workflows.map((row) => row.workflowId).filter((id) => id !== workflowId),
        ])
      : new Set(),
});

/** Reads the check context of one workflow in a read or write transaction. */
export const readCheckContext = (reads: WorkflowLibraryReads, row: StoredWorkflowRow) =>
  Effect.gen(function* () {
    const [workflows, latestVersions, roles] = yield* Effect.all([
      reads.workflows(),
      reads.latestVersions(),
      reads.roles(),
    ]);
    return checkContext(row.workflowId, row.latestVersion, workflows, latestVersions, roles);
  });

export const requireCustomWorkflow = (reads: WorkflowLibraryReads, workflowId: string) =>
  Effect.gen(function* () {
    if (workflowId === BUILTIN_WORKFLOW_ID)
      return yield* invalid(
        `The built-in workflow "${builtinName}" is read-only. Duplicate it to make a custom workflow.`,
      );
    const row = yield* reads.workflow(workflowId);
    if (!row || row.deletedAtMs !== null)
      return yield* invalid(
        `Workflow "${workflowId}" does not exist on this host. Reload the workflow list.`,
      );
    return row;
  });

export const requireVersion = (reads: WorkflowLibraryReads, workflowId: string, version: number) =>
  Effect.gen(function* () {
    const stored = yield* reads.version(workflowId, version);
    if (!stored)
      return yield* invalid(
        `Workflow "${workflowId}" has no version ${version}. Reload the version list.`,
      );
    return stored;
  });

export const requireLatestVersion = (reads: WorkflowLibraryReads, row: StoredWorkflowRow) =>
  row.latestVersion === null
    ? Effect.fail(
        invalid(`Workflow "${row.workflowId}" has no published version. Publish a version first.`),
      )
    : requireVersion(reads, row.workflowId, row.latestVersion);

export const requireDraft = (reads: WorkflowLibraryReads, row: StoredWorkflowRow) =>
  reads
    .draft(row.workflowId)
    .pipe(
      Effect.flatMap((draft) =>
        draft
          ? Effect.succeed(draft)
          : Effect.fail(invalid(`Workflow "${row.workflowId}" has no draft. Reload the workflow.`)),
      ),
    );

/**
 * The document that a copy starts from: the built-in document, else the draft, else the latest
 * version of the custom workflow.
 */
export const sourceDocument = (reads: WorkflowLibraryReads, workflowId: string) =>
  Effect.gen(function* () {
    if (workflowId === BUILTIN_WORKFLOW_ID) return builtinWorkflowDocument();
    const row = yield* requireCustomWorkflow(reads, workflowId);
    const draft = yield* reads.draft(row.workflowId);
    if (draft) return draft.document;
    return versionToDocument((yield* requireLatestVersion(reads, row)).document);
  });

/** The board columns and the transition count of a workflow. */
type WorkflowOverview = Pick<WorkflowLibraryEntry, "states" | "transitionCount">;

/**
 * The board columns and the transition count of a workflow, for the workflow list. The columns
 * keep board order: Backlog first, Done last. Shared states show their built-in name and colour.
 */
type DefinitionState = WorkflowDocument["definition"]["states"][number];
type DefinitionIssueType = WorkflowDocument["definition"]["issueTypes"][number];

/** A state as the library shows it: its label, else its ID, and its tone. */
export const libraryStateOf = (state: DefinitionState): WorkflowLibraryState => {
  const column: WorkflowLibraryState = { id: state.id, label: state.label || state.id };
  if (state.tone) column.tone = state.tone;
  return column;
};

/** An issue type as a task row shows it. */
export const issueTypeOf = ({ id, label, icon }: DefinitionIssueType) =>
  icon ? { id, label, icon } : { id, label };

export const overviewOf = (definition: WorkflowDocument["definition"]): WorkflowOverview => {
  const states = columnOrder(withBuiltinSharedFields(definition).states).map(({ state }) =>
    libraryStateOf(state),
  );
  return { states, transitionCount: definition.events.length };
};

/** A copy of a document, with a new workflow ID and the name "<name> copy" by default. */
export const copyOf = (
  document: WorkflowDocument,
  workflows: readonly StoredWorkflowRow[],
  name = `${document.definition.label} copy`,
): WorkflowDocument => {
  const id = workflowIdFromName(
    name,
    new Set([BUILTIN_WORKFLOW_ID, ...workflows.map(({ workflowId }) => workflowId)]),
  );
  return { ...document, definition: { ...document.definition, id, label: name } };
};

export const nameOf = (
  workflowId: string,
  drafts: ReadonlyMap<string, WorkflowDocument>,
  latest: ReadonlyMap<string, StoredWorkflowVersion>,
) =>
  drafts.get(workflowId)?.definition.label ??
  latest.get(workflowId)?.document.definition.label ??
  workflowId;

export const importHostState = (reads: WorkflowLibraryReads) =>
  Effect.gen(function* () {
    const [workflows, roles] = yield* Effect.all([reads.workflows(), reads.roles()]);
    const state: WorkflowImportHostState = {
      builtinWorkflowId: BUILTIN_WORKFLOW_ID,
      customWorkflows: new Map(
        workflows
          .filter((row) => row.deletedAtMs === null)
          .map((row) => [row.workflowId, { hasDraft: row.draftUpdatedAtMs !== null }]),
      ),
      deletedWorkflowIds: new Set(
        workflows.filter((row) => row.deletedAtMs !== null).map((row) => row.workflowId),
      ),
      roles: [
        ...BUILTIN_ROLES.map((role) => ({ role, source: "builtin" as const })),
        ...roles.map(({ role }) => ({ role, source: "custom" as const })),
      ],
    };
    return state;
  });

export const parseFile = (text: string) => {
  const parsed = parseWorkflowFile(text);
  if (parsed.ok) return Effect.succeed(parsed.file);
  const where = parsed.line === null ? "" : ` (line ${parsed.line}, column ${parsed.column ?? 1})`;
  return Effect.fail(invalid(`${parsed.message}${where}`, "text"));
};

export const joinNames = (names: readonly string[]) => names.join(", ");
export const openTaskCountText = (count: number) =>
  count === 1 ? "1 open task" : `${count} open tasks`;

/** The target of a move: the draft as the next version, or the latest version. */
export const readMoveTarget = (
  reads: WorkflowLibraryReads,
  row: StoredWorkflowRow,
  kind: "draft" | "latest",
): Effect.Effect<{ target: TaskMoveTarget; version: number }, WorkflowLibraryServiceError> =>
  kind === "draft"
    ? requireDraft(reads, row).pipe(
        Effect.map(({ document }) => ({
          target: document.definition,
          version: (row.latestVersion ?? 0) + 1,
        })),
      )
    : requireLatestVersion(reads, row).pipe(
        Effect.map(({ document, version }) => ({ target: document.definition, version })),
      );
