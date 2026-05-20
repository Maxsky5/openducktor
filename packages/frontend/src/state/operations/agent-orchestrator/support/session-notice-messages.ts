import type { AgentChatMessage } from "@/types/agent-orchestrator";

type SessionNoticeMeta = Extract<AgentChatMessage["meta"], { kind: "session_notice" }>;

const buildSessionNoticeMessage = ({
  id,
  timestamp,
  content,
  meta,
}: {
  id?: string;
  timestamp: string;
  content: string;
  meta: SessionNoticeMeta;
}): AgentChatMessage => ({
  id: id ?? crypto.randomUUID(),
  role: "system",
  content,
  timestamp,
  meta,
});

export const USER_STOPPED_NOTICE = "Session stopped at your request.";

export const buildUserStoppedNoticeMessage = (timestamp: string): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: USER_STOPPED_NOTICE,
    meta: {
      kind: "session_notice",
      tone: "cancelled",
      reason: "user_stopped",
      title: "Stopped",
    },
  });

export const buildSessionErrorNoticeMessage = (
  timestamp: string,
  message: string,
): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: message,
    meta: {
      kind: "session_notice",
      tone: "error",
      reason: "session_error",
      title: "Error",
    },
  });

const buildSessionCompactionNoticeMessage = (
  timestamp: string,
  message: string,
  title: string,
  status: "running" | "completed",
  id?: string,
): AgentChatMessage =>
  buildSessionNoticeMessage({
    ...(id ? { id } : {}),
    timestamp,
    content: message,
    meta: {
      kind: "session_notice",
      tone: "info",
      reason: "session_compacted",
      title,
      compactionStatus: status,
    },
  });

export const buildSessionCompactedNoticeMessage = (
  timestamp: string,
  message: string,
  id?: string,
): AgentChatMessage =>
  buildSessionCompactionNoticeMessage(timestamp, message, "Compacted", "completed", id);

export const buildSessionCompactionStartedNoticeMessage = (
  timestamp: string,
  message: string,
  id?: string,
): AgentChatMessage =>
  buildSessionCompactionNoticeMessage(timestamp, message, "Compacting", "running", id);
