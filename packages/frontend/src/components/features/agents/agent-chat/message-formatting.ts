import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole } from "@openducktor/core";
import { agentModelInfoParts } from "@/lib/agent-model-presentation";
import { isFinalAssistantChatMessage } from "@/state/operations/agent-orchestrator/support/messages";
import { SYSTEM_PROMPT_PREFIX } from "@/state/operations/agent-orchestrator/support/session-prompt";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { stripToolPrefix } from "./tool-text-utils";

export { SYSTEM_PROMPT_PREFIX };

const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatTime = (timestamp: string): string => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return MESSAGE_TIME_FORMATTER.format(value);
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

export const toSingleLineMarkdown = (value: string): string => {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const assistantRoleFromMessage = (message: AgentChatMessage): AgentRole | null => {
  if (message.role !== "assistant") {
    return null;
  }
  if (message.meta?.kind === "assistant") {
    return message.meta.agentRole ?? null;
  }
  return null;
};

export const roleLabel = (role: AgentChatMessage["role"], message: AgentChatMessage): string => {
  if (role === "assistant") {
    const assistantRole = assistantRoleFromMessage(message);
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
  runtimeKind: RuntimeKind | null,
  modelCatalog?: AgentModelCatalog | null,
) => {
  if (!isFinalAssistantChatMessage(message)) {
    return { infoParts: [] } satisfies { infoParts: string[] };
  }

  // Native history can omit a turn's model. The session's current model does not prove which one answered.
  if (!message.meta.modelId?.trim() && runtimeKind) {
    return {
      infoParts: [
        message.meta.profileId?.trim(),
        RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label,
        "Model unavailable",
        message.meta.variant?.trim(),
      ].filter((part): part is string => Boolean(part)),
    };
  }

  return { infoParts: agentModelInfoParts(message.meta, modelCatalog) };
};
