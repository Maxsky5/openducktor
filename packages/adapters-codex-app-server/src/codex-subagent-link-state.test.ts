import { describe, expect, test } from "bun:test";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";

describe("CodexSubagentLinkState", () => {
  test("restarts a terminal child only for an explicit new activity transition", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "error",
      error: "First turn failed",
      endedAtMs: 100,
    });

    const staleRunning = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "stale-snapshot",
      status: "running",
    });
    const restarted = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "followup-1",
      status: "running",
      allowStatusRestart: true,
      startedAtMs: 200,
    });

    expect(staleRunning).toMatchObject({ status: "error", error: "First turn failed" });
    expect(restarted.status).toBe("running");
    expect(restarted).not.toHaveProperty("error");
  });

  test("clears links for one runtime without deleting matching thread ids in another runtime", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-2",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-2",
      status: "running",
    });

    subagents.clearSession("parent-thread", "runtime-1");

    expect(subagents.routeForChild("child-thread", "runtime-1")).toBeNull();
    expect(subagents.routeForChild("child-thread", "runtime-2")).toMatchObject({
      parentExternalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      runtimeId: "runtime-2",
    });
  });

  test("clears provisional links without deleting the same correlation in another runtime", () => {
    const subagents = new CodexSubagentLinkState();
    for (const runtimeId of ["runtime-1", "runtime-2"]) {
      subagents.upsertLink({
        runtimeId,
        parentThreadId: "parent-thread",
        itemId: "spawn-1",
        status: "running",
      });
    }

    subagents.clearSession("parent-thread", "runtime-1");

    expect(
      subagents.failUnlinkedSpawnsForParent("parent-thread", "runtime-2", "Spawn failed"),
    ).toHaveLength(1);
  });

  test("ignores an explicit restart older than the terminal lifecycle", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "error",
      error: "Finished",
      endedAtMs: 200,
    });

    const staleRestart = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "resume-1",
      status: "running",
      allowStatusRestart: true,
      startedAtMs: 100,
    });

    expect(staleRestart).toMatchObject({ status: "error", error: "Finished", endedAtMs: 200 });
  });

  test("preserves the newest running start and terminal end timestamps", () => {
    const subagents = new CodexSubagentLinkState();
    const update = (status: "running" | "completed", startedAtMs?: number, endedAtMs?: number) =>
      subagents.upsertLink({
        runtimeId: "runtime-1",
        parentThreadId: "parent-thread",
        childThreadId: "child-thread",
        itemId: "spawn-1",
        status,
        ...(startedAtMs !== undefined ? { startedAtMs } : {}),
        ...(endedAtMs !== undefined ? { endedAtMs } : {}),
      });

    update("running", 200);
    expect(update("running", 100)).toMatchObject({ startedAtMs: 200 });
    update("completed", undefined, 300);
    expect(update("completed", undefined, 150)).toMatchObject({ endedAtMs: 300 });
  });

  test("fails only active provisional spawns in the requested parent runtime", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      itemId: "orphaned-spawn",
      status: "running",
      prompt: "Explore the repository",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "linked-child",
      itemId: "linked-spawn",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-2",
      parentThreadId: "parent-thread",
      itemId: "other-runtime-spawn",
      status: "running",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      itemId: "already-failed-spawn",
      status: "error",
      error: "Codex reported the failure.",
    });
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      itemId: "completed-without-child",
      status: "completed",
    });

    const failed = subagents.failUnlinkedSpawnsForParent(
      "parent-thread",
      "runtime-1",
      "Codex ended this subagent spawn without creating a session.",
    );

    expect(failed).toEqual([
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:orphaned-spawn",
        status: "error",
        error: "Codex ended this subagent spawn without creating a session.",
        prompt: "Explore the repository",
      }),
      expect.objectContaining({
        correlationKey: "codex-subagent:parent-thread:completed-without-child",
        status: "error",
        error: "Codex ended this subagent spawn without creating a session.",
      }),
    ]);
    expect(subagents.statusForChild("linked-child", "runtime-1")).toBe("running");
    expect(
      subagents.failUnlinkedSpawnsForParent("parent-thread", "runtime-2", "Other failure"),
    ).toHaveLength(1);
  });
});
