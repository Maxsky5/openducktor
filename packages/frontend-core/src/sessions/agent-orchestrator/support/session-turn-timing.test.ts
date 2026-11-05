import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { createSessionTurnTiming } from "./session-turn-timing";

const completedReply: AgentChatMessage = {
  id: "reply-1",
  role: "assistant",
  content: "Done",
  timestamp: "2026-11-03T23:28:02.010Z",
  meta: { kind: "assistant", isFinal: true, durationMs: 2_000 },
};
const previousTurnTool: AgentChatMessage = {
  id: "tool-1",
  role: "assistant",
  content: "Checked the build",
  timestamp: "2026-11-03T23:28:01.000Z",
  meta: { kind: "assistant", isFinal: false },
};

describe("session turn timing", () => {
  test("does not measure a reply from turns that ended before the reload", () => {
    const timing = createSessionTurnTiming();
    const messages = createSessionMessagesState("session-1", [previousTurnTool, completedReply]);

    expect(
      timing.resolveTurnDurationMs(
        "session-key",
        "session-1",
        "2026-11-04T22:13:18.192Z",
        messages,
      ),
    ).toBeUndefined();
  });

  test("measures a reply from activity after the last loaded completed reply", () => {
    const timing = createSessionTurnTiming();
    const messages = createSessionMessagesState("session-1", [
      previousTurnTool,
      completedReply,
      {
        id: "reply-2-text",
        role: "assistant",
        content: "Working",
        timestamp: "2026-11-04T22:13:00.000Z",
        meta: { kind: "assistant", isFinal: false },
      },
    ]);

    expect(
      timing.resolveTurnDurationMs(
        "session-key",
        "session-1",
        "2026-11-04T22:13:18.000Z",
        messages,
      ),
    ).toBe(18_000);
  });
});
