import type { RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentKickoffTemplateId,
  type AgentPromptGitContext,
  type AgentRole,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
} from "@openducktor/core";

export const kickoffPrompt = (
  role: AgentRole,
  templateId: AgentKickoffTemplateId,
  taskId: string,
): string => {
  return buildAgentKickoffPrompt({
    role,
    templateId,
    task: { taskId },
  });
};

export const kickoffPromptWithTaskContext = (
  role: AgentRole,
  templateId: AgentKickoffTemplateId,
  task: BuildAgentKickoffPromptInput["task"],
  git?: AgentPromptGitContext,
  overrides?: RepoPromptOverrides,
): string => {
  return buildAgentKickoffPrompt({
    role,
    templateId,
    task,
    ...(git ? { git } : {}),
    ...(overrides ? { overrides } : {}),
  });
};
