import type {
  AgentRoleDefinition,
  WorkspaceRef,
  WorkflowCatalog,
  WorkflowReference,
  WorkspaceWorkflowContext,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { Effect } from "effect";
import type { TaskStoreError } from "./task-repository-ports";

/** The workflow assignment of a task. */
export type TaskWorkflowAssignment = {
  readonly workflowId: string;
  /** Null: the task follows the built-in workflow that ships with the app. */
  readonly workflowVersion: number | null;
};

/**
 * An assignment and the `published_at_ms` of its stored version, from the database read that gave
 * the assignment. Null: the built-in workflow, or a version that the database lacks.
 */
export type StampedTaskWorkflowAssignment = TaskWorkflowAssignment & {
  readonly workflowPublishedAtMs: number | null;
};

/** A task that the task store holds. Pass the task record when the code has read it. */
export type StoredTask = TaskWorkflowAssignment & { readonly id: string };

/** Synchronous lookups in the host version cache. A miss is an error. */
export type TaskWorkflowResolver = {
  /** The workflow version of an assignment, such as the assignment of a stored task. */
  readonly forTask: (assignment: TaskWorkflowAssignment) => TaskWorkflow;
  /** The exact version. No latest-version substitution. */
  readonly forReference: (reference: WorkflowReference) => TaskWorkflow;
};

/** A published custom version. */
export type WorkflowVersionKey = { readonly workflowId: string; readonly version: number };

/** A compiled custom version and the `updated_at_ms` of each custom role that it binds. */
export type CachedWorkflowVersion = {
  readonly workflow: TaskWorkflow;
  /**
   * The `published_at_ms` of the stored version that the entry compiles. A deleted workflow can
   * come back with the same ID and version numbers, so the key alone does not identify a version.
   */
  readonly publishedAtMs: number;
  readonly roleStamps: ReadonlyMap<string, number>;
};

/**
 * The host version cache. A stored version never changes. An entry goes stale only when its
 * workflow is deleted and created again, or when a custom role that it binds changes. The SQLite
 * adapter checks and fills it in the database session that reads task rows, so each task record
 * that the store returns has its stored version in the cache.
 */
export type TaskWorkflowVersionCache = TaskWorkflowResolver & {
  /**
   * The custom versions of these assignments that the cache lacks or holds from another stored
   * version, without duplicates.
   */
  readonly missing: (assignments: Iterable<StampedTaskWorkflowAssignment>) => WorkflowVersionKey[];
  readonly cached: (key: WorkflowVersionKey) => CachedWorkflowVersion | undefined;
  readonly put: (key: WorkflowVersionKey, entry: CachedWorkflowVersion) => void;
  /**
   * Marks the cached versions that bind the role as stale. Call it after a role save or delete
   * commits. A lookup still serves a stale version, so records of earlier reads keep their
   * workflow; the next database read compiles the version again with the new role.
   */
  readonly dropRole: (roleId: string) => void;
  /** Drops the cached versions of the workflow. Call it after a workflow delete commits. */
  readonly dropWorkflow: (workflowId: string) => void;
  /** Keeps the assignment of each task that a database read returned, by workspace and task ID. */
  readonly noteTasks: (tasks: Iterable<StoredTask & { readonly workspaceId: string }>) => void;
  /** The workflow of the task that a database read of this host returned last, or undefined. */
  readonly forTaskId: (workspaceId: string, taskId: string) => TaskWorkflow | undefined;
};

/** The workflow choices of a workspace. Reads availability, versions, and roles from the database. */
export type WorkspaceWorkflowPort = {
  readonly context: (
    scope: WorkspaceRef,
  ) => Effect.Effect<WorkspaceWorkflowContext, TaskStoreError>;
  /** The given available workflow, or the default. Fails when the workflow is not available. */
  readonly newTaskWorkflow: (
    scope: WorkspaceRef,
    workflowId?: string,
  ) => Effect.Effect<TaskWorkflow, TaskStoreError>;
  /** The role catalog, the built-in workflow, the latest custom versions, and the versions in use. */
  readonly catalog: () => Effect.Effect<WorkflowCatalog, TaskStoreError>;
  /**
   * The owners of workflow settings: the latest version of each workflow, the built-in workflow
   * first, and the role catalog.
   */
  readonly settingsOwners: () => Effect.Effect<
    { latest: readonly TaskWorkflow[]; roles: readonly AgentRoleDefinition[] },
    TaskStoreError
  >;
  /**
   * Reads the task with its workflow, after the role copy of its version is current. Each session
   * start and attach calls it, so a role save reaches the sessions that start after it.
   */
  readonly sessionTaskWorkflow: (
    scope: WorkspaceRef & { taskId: string },
  ) => Effect.Effect<TaskWorkflow, TaskStoreError>;
};
