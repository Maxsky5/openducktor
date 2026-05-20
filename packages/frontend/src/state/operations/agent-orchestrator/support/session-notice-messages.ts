import type { AgentChatMessage } from "@/types/agent-orchestrator";

type SessionNoticeMeta = Extract<AgentChatMessage["meta"], { kind: "session_notice" }>;

const buildSessionNoticeMessage = ({
  timestamp,
  content,
  meta,
}: {
  timestamp: string;
  content: string;
  meta: SessionNoticeMeta;
}): AgentChatMessage => ({
  id: crypto.randomUUID(),
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

export const buildSessionCompactedNoticeMessage = (
  timestamp: string,
  message: string,
): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: message,
    meta: {
      kind: "session_notice",
      tone: "info",
      reason: "session_compacted",
      title: "Compacted",
    },
  });
