import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import type { WorkflowRolePolicy, WorkflowRolePolicyResolver } from "@openducktor/core";
import type { ClaudeSessionContext } from "../adapters/claude/claude-agent-sdk-types";
import { claudeWorkflowScope } from "../adapters/claude/claude-agent-sdk-utils";
import { workflowRolePolicyOf } from "../application/agent-sessions/session-role-policies";
import type { PrepareRolePolicy } from "../application/agent-sessions/task-session-operations";

/** The role policy of the built-in task workflow. */
export const builtinWorkflowRolePolicy: WorkflowRolePolicyResolver = ({ role }) =>
  workflowRolePolicyOf(specPlanBuildWorkflow, role);

/** The built-in policy of the workflow role of a Claude session, or null for a repository session. */
export const claudeTestRolePolicy = (session: ClaudeSessionContext): WorkflowRolePolicy | null => {
  const scope = claudeWorkflowScope(session.input);
  return scope === null
    ? null
    : builtinWorkflowRolePolicy({ ...scope, externalSessionId: session.externalSessionId });
};

/** A session preparation that holds no role policy, for tests that resolve the built-in policy. */
export const prepareNoRolePolicy: PrepareRolePolicy = () =>
  Effect.succeed({ keep: () => Effect.void });
