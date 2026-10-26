import type { SubagentMeta } from "../messages/agent-chat-message-card-model.types";
import type { AgentChatMessage } from "../../types/agent-orchestrator";

/** The status label of a Subagent. Both clients show the same words. */
export const subagentStatusLabel = (status: SubagentMeta["status"]): string => {
  if (status === "running") {
    return "Running";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "error") {
    return "Failed";
  }

  return "Queued";
};

export const SUBAGENT_WAITING_FOR_INPUT_LABEL = "Waiting for input";

/** The name of a Subagent, or "Subagent" when the runtime gives none. */
export const subagentDisplayName = (meta: Pick<SubagentMeta, "agent">): string =>
  meta.agent?.trim() || "Subagent";

export const readSubagentSummary = (meta: SubagentMeta): string | null => {
  return meta.description?.trim() || meta.prompt?.trim() || null;
};

export const readSubagentError = (meta: SubagentMeta): string | undefined => {
  return meta.status === "error" ? meta.error?.trim() : undefined;
};

/** A running Subagent with a session and pending requests waits for the user. */
export const isSubagentWaitingForInput = (
  meta: SubagentMeta,
  pendingRequestCount: number,
): boolean => {
  return Boolean(
    meta.externalSessionId &&
    (meta.status === "pending" || meta.status === "running") &&
    pendingRequestCount > 0,
  );
};

/** The run time of a finished Subagent, or null while it runs or without timestamps. */
export const readSubagentDurationMs = (meta: SubagentMeta): number | null => {
  if (meta.status === "pending" || meta.status === "running") {
    return null;
  }
  if (meta.startedAtMs === undefined || meta.endedAtMs === undefined) {
    return null;
  }
  return Math.max(0, meta.endedAtMs - meta.startedAtMs);
};

/** One Subagent of a session, with its latest state. */
export type SessionSubagent = {
  /** The runtime correlation key. It stays the same across updates of the Subagent. */
  key: string;
  meta: SubagentMeta;
};

/**
 * Lists the Subagents of a transcript in the order they started. A later message of the same
 * Subagent replaces its state but keeps its position.
 */
export const listSessionSubagents = (messages: readonly AgentChatMessage[]): SessionSubagent[] => {
  const byKey = new Map<string, SessionSubagent>();
  for (const message of messages) {
    const meta = message.meta;
    if (meta?.kind !== "subagent") continue;
    const key = meta.correlationKey || meta.partId;
    byKey.set(key, { key, meta });
  }
  return Array.from(byKey.values());
};
