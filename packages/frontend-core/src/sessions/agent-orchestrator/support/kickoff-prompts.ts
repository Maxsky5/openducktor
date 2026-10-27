import {
  type AgentKickoffTemplateId,
  buildAgentKickoffPrompt,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";

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
