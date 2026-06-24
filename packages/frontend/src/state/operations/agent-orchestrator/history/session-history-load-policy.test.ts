import { describe, expect, test } from "bun:test";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  requestedSessionHistoryLoadPolicy,
  selectedSessionBaselineHistoryLoadPolicy,
  shouldRequestSelectedSessionBaselineHistory,
} from "./session-history-load-policy";

describe("agent-orchestrator/history/session-history-load-policy", () => {
  test("requests selected-session baseline history for unrequested sessions", () => {
    expect(
      shouldRequestSelectedSessionBaselineHistory(
        createAgentSessionFixture({ historyLoadState: "not_requested", messages: [] }),
      ),
    ).toBe(true);

    expect(
      shouldRequestSelectedSessionBaselineHistory(
        createAgentSessionFixture({ historyLoadState: "loading", messages: [] }),
      ),
    ).toBe(false);

    expect(
      shouldRequestSelectedSessionBaselineHistory(
        createAgentSessionFixture({
          historyLoadState: "not_requested",
          messages: [
            {
              id: "live-user-message",
              role: "user",
              content: "Already visible",
              timestamp: "2026-06-12T08:00:01.000Z",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("merges selected-session baseline history into a transcript that gained live messages", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-live",
      historyLoadState: "loading",
      messages: [
        {
          id: "live-user-message",
          role: "user",
          content: "Already visible",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ],
    });

    const nextSession = selectedSessionBaselineHistoryLoadPolicy.applyLoadedHistory(session, [
      {
        messageId: "history-assistant",
        role: "assistant",
        timestamp: "2026-06-12T08:00:00.500Z",
        text: "Older history",
        parts: [],
      },
    ]);

    expect(nextSession.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(nextSession).map((message) => message.content)).toEqual([
      "Older history",
      "Already visible",
    ]);
  });

  test("merges caller-requested history through the requested-load policy", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-live",
      historyLoadState: "loading",
      messages: [
        {
          id: "live-user-message",
          role: "user",
          content: "Already visible",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ],
    });

    const nextSession = requestedSessionHistoryLoadPolicy.applyLoadedHistory(session, [
      {
        messageId: "history-assistant",
        role: "assistant",
        timestamp: "2026-06-12T08:00:00.500Z",
        text: "Older history",
        parts: [],
      },
    ]);

    expect(nextSession.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(nextSession).map((message) => message.content)).toEqual([
      "Older history",
      "Already visible",
    ]);
  });
});
