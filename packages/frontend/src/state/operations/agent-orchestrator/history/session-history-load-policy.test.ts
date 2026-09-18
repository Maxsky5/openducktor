import { describe, expect, test } from "bun:test";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  requestedSessionHistoryLoadPolicy,
  retainedSessionRevalidationHistoryLoadPolicy,
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

    expect(
      shouldRequestSelectedSessionBaselineHistory(
        createAgentSessionFixture({
          historyLoadState: "loaded",
          messages: [
            {
              id: "retained-message",
              role: "assistant",
              content: "Retained transcript",
              timestamp: "2026-06-12T08:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe(false);
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

  test("claims a retained loaded session without leaving the loaded state", () => {
    const session = createAgentSessionFixture({
      historyLoadState: "loaded",
      historyLoadFailure: {
        code: "request_failed",
        summary: "Stale failure",
        detail: "Stale failure detail",
      },
      messages: [
        {
          id: "retained-message",
          role: "assistant",
          content: "Retained transcript",
          timestamp: "2026-06-12T08:00:00.000Z",
        },
      ],
    });

    const claimed = retainedSessionRevalidationHistoryLoadPolicy.claimLoad(session);

    expect(claimed).not.toBeNull();
    expect(claimed?.historyLoadState).toBe("loaded");
    expect(claimed?.historyLoadFailure).toBeNull();
  });

  test("does not claim retained revalidation for sessions without loaded history", () => {
    for (const historyLoadState of ["not_requested", "loading", "failed"] as const) {
      expect(
        retainedSessionRevalidationHistoryLoadPolicy.claimLoad(
          createAgentSessionFixture({ historyLoadState, messages: [] }),
        ),
      ).toBeNull();
    }
  });

  test("keeps the retained transcript when a revalidation fails", () => {
    const session = createAgentSessionFixture({
      historyLoadState: "loaded",
      messages: [
        {
          id: "retained-message",
          role: "assistant",
          content: "Retained transcript",
          timestamp: "2026-06-12T08:00:00.000Z",
        },
      ],
    });

    const failed = retainedSessionRevalidationHistoryLoadPolicy.failLoad(session, {
      code: "request_failed",
      summary: "Refresh failed",
      detail: "Refresh failed detail",
    });

    expect(failed.historyLoadState).toBe("loaded");
    expect(failed.historyLoadFailure).toEqual({
      code: "request_failed",
      summary: "Refresh failed",
      detail: "Refresh failed detail",
    });
    expect(sessionMessagesToArray(failed).map((message) => message.content)).toEqual([
      "Retained transcript",
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
