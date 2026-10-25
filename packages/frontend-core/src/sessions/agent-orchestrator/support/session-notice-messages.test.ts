import { describe, expect, test } from "bun:test";
import { createSessionMessagesState } from "./messages";
import {
  buildSessionCompactedNoticeMessage,
  buildSessionCompactionStartedNoticeMessage,
  buildSessionErrorNoticeMessage,
  removeRunningSessionCompactionNotices,
} from "./session-notice-messages";

describe("buildSessionCompactedNoticeMessage", () => {
  test("keeps the compaction summary on the completed notice", () => {
    const completed = buildSessionCompactedNoticeMessage(
      "2026-01-01T00:00:00.000Z",
      "## Summary",
      "c1",
      "## Summary",
    );

    expect(completed.meta).toEqual({
      kind: "session_notice",
      tone: "info",
      reason: "session_compacted",
      title: "Compacted",
      compactionStatus: "completed",
      summary: "## Summary",
    });
  });
});

describe("removeRunningSessionCompactionNotices", () => {
  test("preserves the same state when there are no running compaction notices", () => {
    const completed = buildSessionCompactedNoticeMessage("2026-01-01T00:00:00.000Z", "done", "c1");
    const messages = createSessionMessagesState("session-1", [completed]);

    expect(removeRunningSessionCompactionNotices(messages)).toBe(messages);
    expect(
      removeRunningSessionCompactionNotices(createSessionMessagesState("session-1")).items,
    ).toEqual([]);
  });

  test("removes only running compaction notices before failure feedback", () => {
    const completed = buildSessionCompactedNoticeMessage("2026-01-01T00:00:00.000Z", "done", "c1");
    const running = buildSessionCompactionStartedNoticeMessage(
      "2026-01-01T00:00:01.000Z",
      "running",
      "c2",
    );
    const error = buildSessionErrorNoticeMessage("2026-01-01T00:00:02.000Z", "failed");

    expect(
      removeRunningSessionCompactionNotices(
        createSessionMessagesState("session-1", [completed, running, error]),
      ).items,
    ).toEqual([completed, error]);
  });

  test("removes every running notice while preserving notices without a running status", () => {
    const firstRunning = buildSessionCompactionStartedNoticeMessage(
      "2026-01-01T00:00:00.000Z",
      "running",
      "c1",
    );
    const secondRunning = buildSessionCompactionStartedNoticeMessage(
      "2026-01-01T00:00:01.000Z",
      "running",
      "c2",
    );
    const statusless = {
      ...buildSessionCompactedNoticeMessage("2026-01-01T00:00:02.000Z", "legacy", "c3"),
      meta: {
        kind: "session_notice" as const,
        tone: "info" as const,
        reason: "session_compacted" as const,
        title: "Compacted",
      },
    };

    expect(
      removeRunningSessionCompactionNotices(
        createSessionMessagesState("session-1", [firstRunning, statusless, secondRunning]),
      ).items,
    ).toEqual([statusless]);
  });
});
