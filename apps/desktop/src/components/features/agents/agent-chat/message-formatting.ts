import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { toOdtWorkflowToolDisplayName } from "@openducktor/core";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { stripToolPrefix } from "./tool-text-utils";

export const SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

export const formatTime = (timestamp: string): string => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
};

export const formatRawJsonLikeText = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
};

export { stripToolPrefix };

export const toolDisplayName = (tool: string): string => {
  return toOdtWorkflowToolDisplayName(tool);
};

export const toSingleLineMarkdown = (value: string): string => {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const assistantRoleFromMessage = (
  message: AgentChatMessage,
  sessionRole: AgentRole | null,
): AgentRole | null => {
  if (message.role !== "assistant") {
    return null;
  }
  if (message.meta?.kind === "assistant") {
    return message.meta.agentRole;
  }
  return sessionRole;
};

export const roleLabel = (
  role: AgentChatMessage["role"],
  sessionRole: AgentRole | null,
  message: AgentChatMessage,
): string => {
  if (role === "assistant") {
    const assistantRole = assistantRoleFromMessage(message, sessionRole);
    return assistantRole ? AGENT_ROLE_LABELS[assistantRole] : "Assistant";
  }
  if (role === "thinking") {
    return "Thinking";
  }
  if (role === "tool") {
    return "Activity";
  }
  return "System";
};

export const getAssistantFooterData = (
  message: AgentChatMessage,
  sessionSelectedModel: AgentModelSelection | null,
): { infoParts: string[] } => {
  if (message.role !== "assistant") {
    return { infoParts: [] };
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const parts: string[] = [];

  const agentLabel = assistantMeta?.profileId ?? sessionSelectedModel?.profileId;
  if (typeof agentLabel === "string" && agentLabel.trim().length > 0) {
    parts.push(agentLabel.trim());
  }

  const modelLabel = assistantMeta?.modelId ?? sessionSelectedModel?.modelId;
  if (typeof modelLabel === "string" && modelLabel.trim().length > 0) {
    parts.push(modelLabel.trim());
  }

  return { infoParts: parts };
};
