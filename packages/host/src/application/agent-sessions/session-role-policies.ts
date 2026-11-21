import type {
  WorkflowRolePolicy,
  WorkflowRolePolicyResolver,
  WorkflowRolePolicyScope,
} from "@openducktor/core";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect, Exit, type Scope } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";

const sessionKey = ({ workspaceId, externalSessionId }: WorkflowRolePolicyScope) =>
  JSON.stringify([workspaceId, externalSessionId]);
const startKey = ({ workspaceId, taskId, role }: WorkflowRolePolicyScope) =>
  JSON.stringify([workspaceId, taskId, role]);

/** The tools and workspace access of a role in a task workflow version. */
export const workflowRolePolicyOf = (workflow: TaskWorkflow, role: string): WorkflowRolePolicy => {
  const workflowRole = workflow.role(role);
  return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
};

/**
 * The typed failure for a session of a role that the task workflow version does not bind, such as
 * a stopped session of a role that a task move left behind.
 */
const unboundRole = (workflow: TaskWorkflow, scope: WorkflowRolePolicyScope) =>
  workflow.hasRole(scope.role)
    ? undefined
    : new HostValidationError({
        field: "role",
        message: `Version ${workflow.reference.revision} of workflow "${workflow.reference.id}" has no ${scope.role} role, so the ${scope.role} session of task ${scope.taskId} cannot run. Start a session of a role of this version.`,
        details: { workspaceId: scope.workspaceId, taskId: scope.taskId, role: scope.role },
      });

/** The policy of a session that starts now. `keep` gives it to the runtime identity of the session. */
export type PreparedRolePolicy = {
  readonly keep: (externalSessionId: string) => Effect.Effect<void>;
};

export type SessionRolePolicies = {
  /**
   * The policy that runtime adapters and approvals read. Each live session keeps its own policy, so
   * a role save reaches only the sessions that start after it.
   */
  readonly resolve: WorkflowRolePolicyResolver;
  /**
   * Holds the policy of a session that starts, forks, or resumes now, while the scope is open. A new
   * session has no identity yet (`externalSessionId: null`) and keeps the policy through `keep`. A
   * resumed session gets the policy at once and gets its previous policy back when the scope fails.
   * The task workflow has current role copies.
   */
  readonly prepare: (
    scope: WorkflowRolePolicyScope,
    workflow: TaskWorkflow,
  ) => Effect.Effect<PreparedRolePolicy, HostError, Scope.Scope>;
};

/**
 * Host memory of the role policy of live workflow sessions, keyed by workspace and runtime session.
 * A session that this host did not start, such as a session that runs on after a host restart,
 * attaches at its first policy read with the workflow version of the task that this host read last.
 */
export const createSessionRolePolicies = (
  taskWorkflowOf: (workspaceId: string, taskId: string) => TaskWorkflow | undefined,
): SessionRolePolicies => {
  const sessions = new Map<string, WorkflowRolePolicy>();
  // The task lifecycle lock allows one start of a task at a time.
  const starting = new Map<string, WorkflowRolePolicy>();
  const keep = (scope: WorkflowRolePolicyScope, policy: WorkflowRolePolicy) =>
    Effect.sync(() => {
      sessions.set(sessionKey(scope), policy);
    });
  return {
    prepare: (scope, workflow) => {
      const unbound = unboundRole(workflow, scope);
      if (unbound) return Effect.fail(unbound);
      const policy = workflowRolePolicyOf(workflow, scope.role);
      if (scope.externalSessionId === null) {
        const key = startKey(scope);
        return Effect.acquireRelease(
          Effect.sync(() => {
            starting.set(key, policy);
          }),
          () =>
            Effect.sync(() => {
              starting.delete(key);
            }),
        ).pipe(
          Effect.as({
            keep: (externalSessionId: string) => keep({ ...scope, externalSessionId }, policy),
          }),
        );
      }
      const key = sessionKey(scope);
      return Effect.acquireRelease(
        Effect.sync(() => {
          const previous = sessions.get(key);
          sessions.set(key, policy);
          return previous;
        }),
        (previous, exit) =>
          Effect.sync(() => {
            if (Exit.isSuccess(exit)) return;
            if (previous) sessions.set(key, previous);
            else sessions.delete(key);
          }),
      ).pipe(Effect.as({ keep: () => Effect.void }));
    },
    resolve: (scope) => {
      if (scope.externalSessionId === null) {
        const policy = starting.get(startKey(scope));
        if (policy) return policy;
        throw new HostValidationError({
          field: "externalSessionId",
          message: `The new ${scope.role} session of task ${scope.taskId} has no prepared role policy. Start the session from the task again.`,
          details: { workspaceId: scope.workspaceId, taskId: scope.taskId, role: scope.role },
        });
      }
      const known = sessions.get(sessionKey(scope));
      if (known) return known;
      // A runtime that names a new session before it starts, such as Claude, reads the start policy.
      const started = starting.get(startKey(scope));
      if (started) return started;
      const workflow = taskWorkflowOf(scope.workspaceId, scope.taskId);
      if (!workflow)
        throw new HostValidationError({
          field: "taskId",
          message: `The ${scope.role} session of task ${scope.taskId} has no loaded role policy on this host. Reload the task, then retry.`,
          details: { workspaceId: scope.workspaceId, taskId: scope.taskId, role: scope.role },
        });
      const unbound = unboundRole(workflow, scope);
      if (unbound) throw unbound;
      const policy = workflowRolePolicyOf(workflow, scope.role);
      sessions.set(sessionKey(scope), policy);
      return policy;
    },
  };
};
