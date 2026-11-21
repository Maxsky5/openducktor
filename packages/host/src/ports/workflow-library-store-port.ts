import type {
  AgentRoleDefinition,
  WorkflowDocument,
  WorkflowTaskRef,
  WorkflowVersionDocument,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

/**
 * The durable workflow library: custom workflows, drafts, immutable versions, custom roles, and the
 * workflows that each workspace enables. The built-in workflow and the built-in roles have no rows.
 */

export type WorkflowLibraryStoreError = TaskStoreError;

/** A custom workflow. A draft-only workflow has no version. */
export type StoredWorkflowRow = {
  readonly workflowId: string;
  readonly createdAtMs: number;
  /** Null when the workflow has no published version. */
  readonly latestVersion: number | null;
  /** Null when the workflow has no draft. */
  readonly draftUpdatedAtMs: number | null;
  /**
   * Null while the library shows the workflow. A deleted workflow keeps its versions for its closed
   * tasks, and its ID stays taken.
   */
  readonly deletedAtMs: number | null;
};

export type StoredWorkflowDraft = {
  readonly workflowId: string;
  readonly updatedAtMs: number;
  readonly document: WorkflowDocument;
};

export type StoredWorkflowVersion = {
  readonly workflowId: string;
  readonly version: number;
  readonly publishedAtMs: number;
  readonly document: WorkflowVersionDocument;
};

type StoredWorkflowVersionSummary = {
  readonly version: number;
  readonly publishedAtMs: number;
  /** The tasks of every workspace that use this version, closed tasks included. */
  readonly taskCount: number;
};

/** A custom workflow role. `updatedAtMs` is the freshness mark of the version cache. */
export type StoredWorkflowRole = {
  readonly role: AgentRoleDefinition;
  readonly updatedAtMs: number;
};

/** A workflow that not every workspace can use, with the workspaces that its rule lists. */
export type StoredWorkflowAvailability = {
  readonly workflowId: string;
  readonly mode: "only" | "except";
  readonly workspaceIds: readonly string[];
};

/** A task that uses a published version of a custom workflow. */
export type StoredWorkflowTask = {
  readonly workspaceId: string;
  readonly repoName: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly issueType: string;
  readonly version: number;
};

/** The published versions and the draft of one workflow that bind a role. */
type StoredRoleBinding = {
  readonly workflowId: string;
  /** Ascending. */
  readonly versions: readonly number[];
  readonly draft: boolean;
};

export type WorkflowLibraryReads = {
  /** Every custom workflow, ordered by workflow ID. */
  readonly workflows: () => Effect.Effect<StoredWorkflowRow[], WorkflowLibraryStoreError>;
  readonly workflow: (
    workflowId: string,
  ) => Effect.Effect<StoredWorkflowRow | null, WorkflowLibraryStoreError>;
  readonly draft: (
    workflowId: string,
  ) => Effect.Effect<StoredWorkflowDraft | null, WorkflowLibraryStoreError>;
  /** Every draft, ordered by workflow ID. */
  readonly drafts: () => Effect.Effect<StoredWorkflowDraft[], WorkflowLibraryStoreError>;
  /** The versions of one workflow, oldest first. */
  readonly versions: (
    workflowId: string,
  ) => Effect.Effect<StoredWorkflowVersionSummary[], WorkflowLibraryStoreError>;
  readonly version: (
    workflowId: string,
    version: number,
  ) => Effect.Effect<StoredWorkflowVersion | null, WorkflowLibraryStoreError>;
  /** The latest version of each custom workflow that has one, ordered by workflow ID. */
  readonly latestVersions: () => Effect.Effect<StoredWorkflowVersion[], WorkflowLibraryStoreError>;
  /** Every custom role, ordered by role ID. */
  readonly roles: () => Effect.Effect<StoredWorkflowRole[], WorkflowLibraryStoreError>;
  /** The availability rules, ordered by workflow ID. A workflow without a rule is available to all. */
  readonly availability: () => Effect.Effect<
    StoredWorkflowAvailability[],
    WorkflowLibraryStoreError
  >;
  /** The workflow of a new task. Every workspace can use it. */
  readonly defaultWorkflowId: () => Effect.Effect<string, WorkflowLibraryStoreError>;
  /** The IDs of every workspace, open and closed, ordered by ID. */
  readonly workspaceIds: () => Effect.Effect<string[], WorkflowLibraryStoreError>;
  /**
   * The tasks on a published version below `belowVersion`, closed tasks included, ordered by
   * workspace then task ID. Tasks of the built-in version (`workflow_version` NULL) never appear.
   */
  readonly tasksBelowVersion: (
    workflowId: string,
    belowVersion: number,
  ) => Effect.Effect<StoredWorkflowTask[], WorkflowLibraryStoreError>;
  /** Every task of the workflow, closed tasks included, ordered by workspace then task ID. */
  readonly tasksOfWorkflow: (
    workflowId: string,
  ) => Effect.Effect<StoredWorkflowTask[], WorkflowLibraryStoreError>;
  /** The workflows whose versions or draft bind the role, ordered by workflow ID. */
  readonly roleBindings: (
    roleId: string,
  ) => Effect.Effect<StoredRoleBinding[], WorkflowLibraryStoreError>;
};

export type WorkflowLibraryWrites = {
  /** Creates a draft-only workflow. Fails when the ID is taken. */
  readonly createWorkflow: (input: {
    workflowId: string;
    nowMs: number;
    document: WorkflowDocument;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /** Creates or replaces the draft of an existing workflow. */
  readonly saveDraft: (input: {
    workflowId: string;
    nowMs: number;
    document: WorkflowDocument;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  readonly deleteDraft: (workflowId: string) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /** Changes the ID of a workflow without a version. The draft follows the new ID. */
  readonly renameWorkflow: (input: {
    from: string;
    to: string;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  readonly insertVersion: (input: {
    workflowId: string;
    version: number;
    nowMs: number;
    document: WorkflowVersionDocument;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /**
   * Deletes the workflow, its draft and versions, and the settings keyed by the workflow: prompt
   * overrides and appends (global and per workspace) and Autopilot rules. The caller checks first
   * that no workspace enables it and no task uses it.
   */
  readonly deleteWorkflow: (workflowId: string) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /**
   * Deletes the workflow like `deleteWorkflow`, but keeps its row and its versions for the closed
   * tasks that use them. The row gets `deleted_at_ms`. The caller checks first that no workspace
   * enables it and no open task uses it.
   */
  readonly deleteWorkflowKeepingVersions: (input: {
    workflowId: string;
    nowMs: number;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /**
   * Sets `workflow_version` of the given tasks of the workflow. It keeps `updated_at` and every
   * other column. It returns the tasks that changed.
   */
  readonly moveTasks: (input: {
    workflowId: string;
    version: number;
    tasks: readonly WorkflowTaskRef[];
  }) => Effect.Effect<WorkflowTaskRef[], WorkflowLibraryStoreError>;
  /**
   * Creates or replaces a custom role. After the commit, the host version cache drops the cached
   * versions that bind the role.
   */
  readonly saveRole: (input: {
    role: AgentRoleDefinition;
    nowMs: number;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /**
   * Deletes a custom role and the settings keyed by the role: instruction overrides and appends
   * (global and per workspace), workspace model defaults, and runtime role overrides. After the
   * commit, the host version cache drops the cached versions that bind the role.
   */
  readonly deleteRole: (roleId: string) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /** Replaces the availability rule of a workflow. Null makes it available to every workspace. */
  readonly setAvailability: (input: {
    workflowId: string;
    rule: Omit<StoredWorkflowAvailability, "workflowId"> | null;
  }) => Effect.Effect<void, WorkflowLibraryStoreError>;
  /** Sets the workflow of a new task. The caller checks that every workspace can use it. */
  readonly setDefaultWorkflow: (
    workflowId: string,
  ) => Effect.Effect<void, WorkflowLibraryStoreError>;
};

export type WorkflowLibraryTransaction = WorkflowLibraryReads & WorkflowLibraryWrites;

export type WorkflowLibraryStorePort = {
  /** Runs reads in one read transaction, so they see one consistent database state. */
  readonly read: <A, E>(
    operation: string,
    use: (reads: WorkflowLibraryReads) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | WorkflowLibraryStoreError>;
  /**
   * Runs one write transaction. It takes the write lock before the first read, so every value
   * that `use` reads stays current until the commit. A failure of `use` rolls back every write.
   */
  readonly transact: <A, E>(
    operation: string,
    use: (transaction: WorkflowLibraryTransaction) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | WorkflowLibraryStoreError>;
};
