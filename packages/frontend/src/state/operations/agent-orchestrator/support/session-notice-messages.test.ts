import { describe, expect, test } from "bun:test";
import { createSessionMessagesState } from "./messages";
import {
  buildSessionCompactedNoticeMessage,
  buildSessionCompactionStartedNoticeMessage,
  buildSessionErrorNoticeMessage,
  removeRunningSessionCompactionNotices,
} from "./session-notice-messages";

describe("removeRunningSessionCompactionNotices", () => {
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
});
