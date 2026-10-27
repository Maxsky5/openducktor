import type { WorkflowRolePolicy } from "@openducktor/core";
import type { ClaudeSessionContext } from "../adapters/claude/claude-agent-sdk-types";
import { claudeWorkflowScope } from "../adapters/claude/claude-agent-sdk-utils";
import { workflowRolePolicies } from "../composition/node/task-workflow-composition";
import { builtinTaskWorkflows } from "./task-workflows";

/** The role policy of the built-in task workflow. */
export const builtinWorkflowRolePolicy = workflowRolePolicies(builtinTaskWorkflows);

/** The built-in policy of the workflow role of a Claude session, or null for a repository session. */
export const claudeTestRolePolicy = (session: ClaudeSessionContext): WorkflowRolePolicy | null => {
  const scope = claudeWorkflowScope(session.input);
  return scope === null ? null : builtinWorkflowRolePolicy(scope);
};
