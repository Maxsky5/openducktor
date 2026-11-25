import type { AgentRoleDefinition } from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  BUILTIN_WORKFLOW_ID,
  createTaskWorkflow,
  promptTemplatesOfDocument,
  specPlanBuildWorkflow,
  withBuiltinSharedFields,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { HostValidationError } from "../../effect/host-errors";
import type {
  CachedWorkflowVersion,
  TaskWorkflowAssignment,
  TaskWorkflowVersionCache,
  WorkflowVersionKey,
} from "../../ports/task-workflow-port";
import type { StoredWorkflowVersion } from "../../ports/workflow-library-store-port";

const keyOf = ({ workflowId, version }: WorkflowVersionKey) => `${workflowId}@${version}`;
const taskKeyOf = (workspaceId: string, taskId: string) => JSON.stringify([workspaceId, taskId]);

/** The assignment of a task that follows the built-in workflow. */
export const BUILTIN_TASK_ASSIGNMENT: TaskWorkflowAssignment = Object.freeze({
  workflowId: BUILTIN_WORKFLOW_ID,
  workflowVersion: null,
});

/** The stored assignment of a new task that follows the workflow. */
export const assignmentOf = (workflow: TaskWorkflow): TaskWorkflowAssignment => ({
  workflowId: workflow.reference.id,
  workflowVersion:
    workflow.reference.id === BUILTIN_WORKFLOW_ID ? null : workflow.reference.revision,
});

/** The built-in roles and the custom roles. */
export const roleCatalogOf = (
  customRoles: readonly AgentRoleDefinition[],
): AgentRoleDefinition[] => [...BUILTIN_ROLES, ...customRoles];

/**
 * Compiles a published custom version. The host gives each state and notification kind that the
 * built-in workflow uses the built-in display at each compile.
 */
export const compileWorkflowVersion = (
  { workflowId, version, publishedAtMs, document }: StoredWorkflowVersion,
  customRoles: ReadonlyMap<string, { role: AgentRoleDefinition; updatedAtMs: number }>,
): CachedWorkflowVersion => {
  try {
    const workflow = createTaskWorkflow(
      withBuiltinSharedFields(document.definition),
      promptTemplatesOfDocument(document.prompts),
      roleCatalogOf([...customRoles.values()].map(({ role }) => role)),
    );
    const roleStamps = new Map<string, number>();
    for (const { id } of workflow.definition.roles) {
      const custom = customRoles.get(id);
      if (custom) roleStamps.set(id, custom.updatedAtMs);
    }
    return { workflow, publishedAtMs, roleStamps };
  } catch (cause) {
    throw new HostValidationError({
      field: "workflow",
      message: `Workflow "${workflowId}" version ${version} does not compile: ${cause instanceof Error ? cause.message : String(cause)} Publish a corrected version and move its tasks.`,
      cause,
      details: { workflowId, version },
    });
  }
};

/**
 * The host version cache. The built-in workflow resolves tasks without a stored version. The
 * cache never reads the database: the SQLite adapter checks and fills it before it returns task
 * records.
 */
export const createTaskWorkflowVersionCache = (
  builtin: TaskWorkflow = specPlanBuildWorkflow,
): TaskWorkflowVersionCache => {
  const entries = new Map<string, CachedWorkflowVersion>();
  // Entries of a saved role. A lookup still serves them; the next database read compiles them again.
  const stale = new Set<string>();
  const assignments = new Map<string, TaskWorkflowAssignment>();
  const lookup = (key: WorkflowVersionKey): TaskWorkflow => {
    const entry = entries.get(keyOf(key));
    if (!entry)
      throw new HostValidationError({
        field: "workflow",
        message: `Workflow "${key.workflowId}" version ${key.version} is not loaded on this host. Reload the task and retry.`,
        details: { workflowId: key.workflowId, version: key.version },
      });
    return entry.workflow;
  };
  const cache: TaskWorkflowVersionCache = {
    forTask: ({ workflowId, workflowVersion }) => {
      if (workflowVersion !== null) return lookup({ workflowId, version: workflowVersion });
      if (workflowId !== builtin.reference.id)
        throw new HostValidationError({
          field: "workflow",
          message: `A task of workflow "${workflowId}" has no version. Move the task to a published version of the workflow.`,
          details: { workflowId },
        });
      return builtin;
    },
    forReference: ({ id, revision }) =>
      id === builtin.reference.id && revision === builtin.reference.revision
        ? builtin
        : lookup({ workflowId: id, version: revision }),
    missing: (assignments) => {
      const missing = new Map<string, WorkflowVersionKey>();
      for (const { workflowId, workflowVersion, workflowPublishedAtMs } of assignments) {
        if (workflowVersion === null) continue;
        const key = { workflowId, version: workflowVersion };
        if (
          stale.has(keyOf(key)) ||
          entries.get(keyOf(key))?.publishedAtMs !== workflowPublishedAtMs
        )
          missing.set(keyOf(key), key);
      }
      return [...missing.values()];
    },
    cached: (key) => (stale.has(keyOf(key)) ? undefined : entries.get(keyOf(key))),
    put: (key, entry) => {
      entries.set(keyOf(key), entry);
      stale.delete(keyOf(key));
    },
    dropRole: (roleId) => {
      for (const [key, entry] of entries)
        if (entry.workflow.definition.roles.some(({ id }) => id === roleId)) stale.add(key);
    },
    dropWorkflow: (workflowId) => {
      for (const [key, entry] of entries)
        if (entry.workflow.reference.id === workflowId) {
          entries.delete(key);
          stale.delete(key);
        }
    },
    noteTasks: (tasks) => {
      for (const { workspaceId, id, workflowId, workflowVersion } of tasks)
        assignments.set(taskKeyOf(workspaceId, id), { workflowId, workflowVersion });
    },
    forTaskId: (workspaceId, taskId) => {
      const assignment = assignments.get(taskKeyOf(workspaceId, taskId));
      return assignment && cache.forTask(assignment);
    },
  };
  return cache;
};
