import type { RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentKickoffTemplateId,
  type AgentPromptGitContext,
  type AgentRole,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
  buildAgentMessagePrompt,
} from "@openducktor/core";
import {
  defaultSessionLaunchActionForRole,
  getSessionLaunchAction,
  getSessionLaunchActionsForRole,
  isSessionLaunchActionId,
  SESSION_LAUNCH_ACTIONS,
  type SessionLaunchActionId,
} from "./session-start-launch-options";

type TaskPromptContext = {
  title?: string;
  issueType?: "task" | "feature" | "bug" | "epic";
  status?: string;
  qaRequired?: boolean;
  description?: string;
};

type SessionStartPromptOptions = {
  overrides?: RepoPromptOverrides;
  task?: TaskPromptContext;
  git?: AgentPromptGitContext;
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
};

export const LAUNCH_ACTIONS_BY_ROLE: Record<AgentRole, SessionLaunchActionId[]> = {
  spec: getSessionLaunchActionsForRole("spec").map((action) => action.id),
  planner: getSessionLaunchActionsForRole("planner").map((action) => action.id),
  build: getSessionLaunchActionsForRole("build").map((action) => action.id),
  qa: getSessionLaunchActionsForRole("qa").map((action) => action.id),
};

export const LAUNCH_ACTION_LABELS: Record<SessionLaunchActionId, string> = {
  spec_initial: SESSION_LAUNCH_ACTIONS.spec_initial.label,
  planner_initial: SESSION_LAUNCH_ACTIONS.planner_initial.label,
  build_implementation_start: SESSION_LAUNCH_ACTIONS.build_implementation_start.label,
  build_after_qa_rejected: SESSION_LAUNCH_ACTIONS.build_after_qa_rejected.label,
  build_after_human_request_changes: SESSION_LAUNCH_ACTIONS.build_after_human_request_changes.label,
  build_pull_request_generation: SESSION_LAUNCH_ACTIONS.build_pull_request_generation.label,
  build_rebase_conflict_resolution: SESSION_LAUNCH_ACTIONS.build_rebase_conflict_resolution.label,
  qa_review: SESSION_LAUNCH_ACTIONS.qa_review.label,
};

export const isLaunchActionId = isSessionLaunchActionId;

export const firstLaunchAction = (role: AgentRole): SessionLaunchActionId => {
  return defaultSessionLaunchActionForRole(role);
};

export const kickoffPromptForTemplate = (
  role: AgentRole,
  templateId: AgentKickoffTemplateId,
  taskId: string,
  options?: SessionStartPromptOptions,
): string => {
  return buildAgentKickoffPrompt({
    role,
    templateId,
    task: {
      taskId,
      ...(options?.task ?? {}),
    },
    ...(options?.extraPlaceholders ? { extraPlaceholders: options.extraPlaceholders } : {}),
    ...(options?.git ? { git: options.git } : {}),
    overrides: options?.overrides ?? {},
  });
};

export const kickoffPromptForLaunchAction = (
  role: AgentRole,
  actionId: SessionLaunchActionId,
  taskId: string,
  options?: SessionStartPromptOptions,
): string => {
  const templateId = getSessionLaunchAction(actionId).kickoffTemplateId;
  if (!templateId) {
    throw new Error(`Launch action "${actionId}" does not define a kickoff prompt.`);
  }
  return kickoffPromptForTemplate(role, templateId, taskId, options);
};

export const buildGitConflictResolutionPrompt = (
  taskId: string,
  options?: SessionStartPromptOptions & {
    git?: AgentPromptGitContext;
  },
): string => {
  return buildAgentMessagePrompt({
    role: "build",
    templateId: "message.build_rebase_conflict_resolution",
    task: {
      taskId,
      ...(options?.task ?? {}),
    },
    ...(options?.git ? { git: options.git } : {}),
    overrides: options?.overrides ?? {},
  });
};
