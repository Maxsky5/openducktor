import type { AgentChatMessage } from "@/types/agent-orchestrator";

const buildSessionNoticeMessage = ({
  timestamp,
  content,
  tone,
  title,
}:
  | {
      timestamp: string;
      content: string;
      tone: "cancelled";
      title: string;
    }
  | {
      timestamp: string;
      content: string;
      tone: "error";
      title: string;
    }
  | {
      timestamp: string;
      content: string;
      tone: "info";
      title: string;
    }): AgentChatMessage => ({
  id: crypto.randomUUID(),
  role: "system",
  content,
  timestamp,
  meta:
    tone === "cancelled"
      ? {
          kind: "session_notice",
          tone: "cancelled",
          reason: "user_stopped",
          title,
        }
      : tone === "info"
        ? {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title,
          }
        : {
            kind: "session_notice",
            tone: "error",
            reason: "session_error",
            title,
          },
});

export const USER_STOPPED_NOTICE = "Session stopped at your request.";

export const buildUserStoppedNoticeMessage = (timestamp: string): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: USER_STOPPED_NOTICE,
    tone: "cancelled",
    title: "Stopped",
  });

export const buildSessionErrorNoticeMessage = (
  timestamp: string,
  message: string,
): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: message,
    tone: "error",
    title: "Error",
  });

export const buildSessionCompactedNoticeMessage = (
  timestamp: string,
  message: string,
): AgentChatMessage =>
  buildSessionNoticeMessage({
    timestamp,
    content: message,
    tone: "info",
    title: "Compacted",
  });
