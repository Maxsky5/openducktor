import type { RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentKickoffTemplateId,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
  getSessionLaunchAction,
  type BuiltinIssueTypeId as IssueType,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";

type TaskPromptContext = {
  title?: string;
  issueType?: IssueType;
  status?: string;
  description?: string;
};

type SharedPromptOptions = {
  overrides?: RepoPromptOverrides;
  task?: TaskPromptContext;
};

type SessionStartKickoffPromptOptions = SharedPromptOptions & {
  git?: BuildAgentKickoffPromptInput["git"];
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
};

export const kickoffPromptForTemplate = (
  role: AgentRole,
  templateId: AgentKickoffTemplateId,
  taskId: string,
  options?: SessionStartKickoffPromptOptions,
): string => {
  const promptInput: Parameters<typeof buildAgentKickoffPrompt>[0] = {
    role,
    templateId,
    task: {
      taskId,
      ...options?.task,
    },
    overrides: options?.overrides ?? {},
  };

  if (options?.extraPlaceholders) {
    promptInput.extraPlaceholders = options.extraPlaceholders;
  }

  if (options?.git) {
    promptInput.git = options.git;
  }

  return buildAgentKickoffPrompt(promptInput);
};

export const kickoffPromptForLaunchAction = (
  role: AgentRole,
  actionId: SessionLaunchActionId,
  taskId: string,
  options?: SessionStartKickoffPromptOptions,
): string => {
  const { template } = getSessionLaunchAction(actionId);
  if (template.kind !== "kickoff") {
    throw new Error(`Launch action "${actionId}" does not define a kickoff prompt.`);
  }
  return kickoffPromptForTemplate(role, template.id, taskId, options);
};
