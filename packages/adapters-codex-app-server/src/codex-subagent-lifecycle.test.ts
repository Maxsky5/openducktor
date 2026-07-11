import { describe, expect, test } from "bun:test";
import { codexSubagentLifecycleUpdateFromNotification } from "./codex-subagent-lifecycle";

const notification = (method: string, turn: Record<string, unknown>) => ({
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
        notification("turn/started", {
          id: "turn-1",
          status: "inProgress",
          startedAt: 1_783_684_799,
        }),
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
        notification("turn/completed", {
          id: "turn-1",
          status: "completed",
          completedAt: 1_783_684_800,
        }),
      ),
    ).toEqual({
      status: "completed",
      allowStatusRestart: false,
      timestampMs: 1_783_684_800_000,
    });
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification("turn/completed", {
          id: "turn-2",
          status: "failed",
          completedAt: 1_783_684_800,
          error: { message: "Child failed" },
        }),
      ),
    ).toEqual({
      status: "error",
      allowStatusRestart: false,
      timestampMs: 1_783_684_800_000,
      error: "Child failed",
    });
  });

  test("uses snake-case Codex lifecycle timestamps when present", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification("turn/started", {
          id: "turn-1",
          status: "inProgress",
          started_at: 1_783_684_799,
        }),
      ),
    ).toMatchObject({ timestampMs: 1_783_684_799_000 });
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification("turn/completed", {
          id: "turn-1",
          status: "completed",
          completed_at: 1_783_684_800,
        }),
      ),
    ).toMatchObject({ timestampMs: 1_783_684_800_000 });
  });

  test("keeps interrupted child threads resumable and ignores idle status notifications", () => {
    expect(
      codexSubagentLifecycleUpdateFromNotification(
        notification("turn/completed", { id: "turn-1", status: "interrupted" }),
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
        notification("turn/completed", { id: "turn-1", status: "inProgress" }),
      ),
    ).toThrow("unexpected turn status 'inProgress'");
  });
});
