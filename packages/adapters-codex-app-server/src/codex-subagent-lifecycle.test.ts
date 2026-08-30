import { describe, expect, test } from "bun:test";
import type { CodexAppServerTurn } from "@openducktor/contracts";
import { codexSubagentLifecycleUpdateFromNotification } from "./codex-subagent-lifecycle";
import { codexTurnFixture } from "./test-fixtures/codex-protocol";

const notification = (method: "turn/started" | "turn/completed", turn: CodexAppServerTurn) => ({
  method,
  receivedAt: "2026-07-10T12:00:00.000Z",
  params: {
    threadId: "child-thread",
    turn,
  },
});

describe("codexSubagentLifecycleUpdateFromNotification", () => {
  test("treats a new child turn as an explicit restart", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/started",
          codexTurnFixture({
            items: [],
            id: "turn-1",
            status: "inProgress",
            startedAt: 1_783_684_799,
          }),
        ),
      ),
    ).toEqual({
      status: "running",
      allowStatusRestart: true,
      timestampMs: 1_783_684_799_000,
    });
  });

  test("maps completed and failed child turns to terminal statuses", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/completed",
          codexTurnFixture({
            completedAt: 1_783_684_800,
            id: "turn-1",
            items: [],
            status: "completed",
          }),
        ),
      ),
    ).toEqual({
      status: "completed",
      allowStatusRestart: false,
      timestampMs: 1_783_684_800_000,
    });
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/completed",
          codexTurnFixture({
            completedAt: 1_783_684_800,
            error: {
              additionalDetails: null,
              codexErrorInfo: null,
              message: "Child failed",
            },
            id: "turn-2",
            items: [],
            status: "failed",
          }),
        ),
      ),
    ).toEqual({
      status: "error",
      allowStatusRestart: false,
      timestampMs: 1_783_684_800_000,
      error: "Child failed",
    });
  });

  test("uses receipt time when the exact Codex lifecycle timestamp is null", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/started",
          codexTurnFixture({ id: "turn-1", items: [], status: "inProgress" }),
        ),
      ),
    ).toMatchObject({ timestampMs: Date.parse("2026-07-10T12:00:00.000Z") });
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/completed",
          codexTurnFixture({ id: "turn-1", items: [], status: "completed" }),
        ),
      ),
    ).toMatchObject({ timestampMs: Date.parse("2026-07-10T12:00:00.000Z") });
  });

  test("keeps interrupted child threads resumable and ignores idle status notifications", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/completed",
          codexTurnFixture({ id: "turn-1", items: [], status: "interrupted" }),
        ),
      ),
    ).toBeNull();
    expect(
      codexSubagentLifecycleUpdateFromNotification({
        method: "thread/status/changed",
        receivedAt: "2026-07-10T12:00:00.000Z",
        params: { threadId: "child-thread", status: { type: "idle" } },
      }),
    ).toBeNull();
  });

  test("fails fast on lifecycle shapes outside the verified Codex contract", () => {
    expect(() =>
      codexSubagentLifecycleUpdateFromNotification(
        notification(
          "turn/completed",
          codexTurnFixture({ id: "turn-1", items: [], status: "inProgress" }),
        ),
      ),
    ).toThrow("unexpected turn status 'inProgress'");
  });
});
