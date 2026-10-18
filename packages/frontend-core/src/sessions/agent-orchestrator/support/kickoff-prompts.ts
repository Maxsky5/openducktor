import {
  type AgentKickoffTemplateId,
  type AgentRole,
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
