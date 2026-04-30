import type { AgentChatMessage, AgentChatMessageMeta } from "@/types/agent-orchestrator";

export type SubagentMeta = Extract<AgentChatMessageMeta, { kind: "subagent" }>;
export type SubagentMessage = AgentChatMessage & {
  role: "system";
  meta: SubagentMeta;
};

const isTerminalSubagentStatus = (status: SubagentMeta["status"]): boolean => {
  return status === "completed" || status === "cancelled" || status === "error";
};

export const isSubagentMessage = (
  message: AgentChatMessage | null | undefined,
): message is SubagentMessage => {
  return message?.role === "system" && message.meta?.kind === "subagent";
};

export const resolveSubagentStatus = (
  existingStatus: SubagentMeta["status"] | undefined,
  incomingStatus: SubagentMeta["status"],
): SubagentMeta["status"] => {
  if (existingStatus === "error") {
    return "error";
  }
  if (incomingStatus === "error") {
    return "error";
  }
  if (existingStatus === "cancelled") {
    return "cancelled";
  }
  if (incomingStatus === "cancelled") {
    return "cancelled";
  }
  if (existingStatus === "completed") {
    return "completed";
  }
  if (incomingStatus === "completed") {
    return "completed";
  }
  if (existingStatus === "running" && incomingStatus === "pending") {
    return "running";
  }

  return incomingStatus;
};

export const formatSubagentContent = (meta: {
  agent?: string;
  prompt?: string;
  description?: string;
  externalSessionId?: string;
}): string => {
  const agentLabel = meta.agent?.trim() || "subagent";
  const summary =
    meta.description?.trim() ||
    meta.prompt?.trim() ||
    (meta.externalSessionId
      ? `Session ${meta.externalSessionId.slice(0, 8)}`
      : "Subagent activity");

  return `Subagent (${agentLabel}): ${summary}`;
};

export const mergeSubagentMeta = (
  existingMeta: SubagentMeta | null | undefined,
  incomingMeta: SubagentMeta,
  options?: {
    startedAtMsFallback?: number;
  },
): SubagentMeta => {
  const status = resolveSubagentStatus(existingMeta?.status, incomingMeta.status);
  const metadata =
    existingMeta?.metadata && incomingMeta.metadata
      ? { ...existingMeta.metadata, ...incomingMeta.metadata }
      : (incomingMeta.metadata ?? existingMeta?.metadata);
  const startedAtMs =
    typeof existingMeta?.startedAtMs === "number" && typeof incomingMeta.startedAtMs === "number"
      ? Math.min(existingMeta.startedAtMs, incomingMeta.startedAtMs)
      : (incomingMeta.startedAtMs ?? existingMeta?.startedAtMs ?? options?.startedAtMsFallback);
  const endedAtMs =
    typeof existingMeta?.endedAtMs === "number" && typeof incomingMeta.endedAtMs === "number"
      ? Math.max(existingMeta.endedAtMs, incomingMeta.endedAtMs)
      : isTerminalSubagentStatus(status)
        ? (incomingMeta.endedAtMs ?? existingMeta?.endedAtMs)
        : undefined;
  const agent = incomingMeta.agent ?? existingMeta?.agent;
  const prompt = incomingMeta.prompt ?? existingMeta?.prompt;
  const description = incomingMeta.description ?? existingMeta?.description;
  const externalSessionId = incomingMeta.externalSessionId ?? existingMeta?.externalSessionId;
  const executionMode = incomingMeta.executionMode ?? existingMeta?.executionMode;

  return {
    kind: "subagent",
    partId: incomingMeta.partId,
    correlationKey: incomingMeta.correlationKey,
    status,
    ...(typeof agent === "string" ? { agent } : {}),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof externalSessionId === "string" ? { externalSessionId } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(metadata ? { metadata } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};
