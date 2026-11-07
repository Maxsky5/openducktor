import type { TaskWorkflow } from "../task-workflow/task-workflow";
import { specPlanBuildWorkflow } from "./spec-plan-build/workflow";

export {
  type AgentPromptGitContext,
  type BuildAgentKickoffPromptInput,
  buildGitConflictAssistancePrompt,
  buildReadOnlyPermissionRejectionMessage,
  gitConflictPromptContext,
  resolvePullRequestTarget,
} from "./spec-plan-build/agent-prompts";
export { SPEC_PLAN_BUILD_BOARD_LAYOUT } from "./spec-plan-build/board";
export { SPEC_PLAN_BUILD_BOARD, specPlanBuildWorkflow } from "./spec-plan-build/workflow";
export { BUILTIN_ROLES } from "./roles/roles";
export { resolveCodexRolePolicy } from "./roles/role-policy";

/** The built-in task workflows. */
export const BUILTIN_TASK_WORKFLOWS: readonly TaskWorkflow[] = [specPlanBuildWorkflow];
