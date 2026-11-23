import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";

export const ANTIGRAVITY_COMPACT_COMMAND = `/${MANUAL_SESSION_COMPACTION_SLASH_COMMAND.trigger}`;
export const ANTIGRAVITY_COMPACTED_MESSAGE = "Session compacted.";

/** The history notice of a finished compaction, in place of its `/compact` message. */
export const compactionNotice = (
  messageId: string,
  timestamp: string,
  accuracy: { timestampIsApproximate?: true } = {},
): AgentSessionHistoryMessage => ({
  messageId,
  role: "system",
  timestamp,
  ...accuracy,
  text: ANTIGRAVITY_COMPACTED_MESSAGE,
  notice: { tone: "info", reason: "session_compacted", title: "Compacted" },
  parts: [],
});
