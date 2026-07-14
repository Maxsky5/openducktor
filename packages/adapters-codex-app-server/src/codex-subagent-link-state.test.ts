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

  test("restarts a child completed by a snapshot only for newer activity", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
      startedAtMs: 200,
    });
    subagents.recordThread(
      {
        id: "child-thread",
        cwd: "/repo",
        startedAt: "1970-01-01T00:00:00.200Z",
        updatedAtMs: 250,
        title: "Child thread",
        parentThreadId: "parent-thread",
        status: { classification: "idle" },
        agentNickname: null,
        agentRole: null,
        subAgentSource: null,
      },
      "runtime-1",
    );

    const staleRestart = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "stale-resume",
      status: "running",
      allowStatusRestart: true,
      startedAtMs: 100,
    });
    const restarted = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "new-resume",
      status: "running",
      allowStatusRestart: true,
      startedAtMs: 300,
    });

    expect(staleRestart).toMatchObject({ status: "completed", startedAtMs: 200 });
    expect(restarted).toMatchObject({ status: "running", startedAtMs: 300 });
  });

  test("keeps an inventory-completed child terminal for delayed restart evidence", () => {
    const subagents = new CodexSubagentLinkState();
    subagents.recordThread(
      {
        id: "child-thread",
        cwd: "/repo",
        startedAt: "1970-01-01T00:00:00.100Z",
        updatedAtMs: 200,
        title: "Child thread",
        parentThreadId: "parent-thread",
        status: { classification: "idle" },
        agentNickname: null,
        agentRole: null,
        subAgentSource: null,
      },
      "runtime-1",
    );

    const delayedRestart = subagents.upsertLink({
      runtimeId: "runtime-1",
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "delayed-restart",
      status: "running",
      allowStatusRestart: true,
      startedAtMs: 150,
    });

    expect(delayedRestart).toMatchObject({ status: "completed", endedAtMs: 200 });
  });

  test("lets newer active inventory reopen an inventory-completed child", () => {
    const subagents = new CodexSubagentLinkState();
    const thread = {
      id: "child-thread",
      cwd: "/repo",
      startedAt: "1970-01-01T00:00:00.100Z",
      title: "Child thread",
      parentThreadId: "parent-thread",
      agentNickname: null,
      agentRole: null,
      subAgentSource: null,
    };
    subagents.recordThread(
      {
        ...thread,
        updatedAtMs: 200,
        status: { classification: "idle" },
      },
      "runtime-1",
    );

    subagents.recordThread(
      {
        ...thread,
        updatedAtMs: 300,
        status: { classification: "running" },
      },
      "runtime-1",
    );

    expect(subagents.statusForChild("child-thread", "runtime-1")).toBe("running");
  });

  test("does not restart untimed failed or cancelled children", () => {
    for (const status of ["error", "cancelled"] as const) {
      const subagents = new CodexSubagentLinkState();
      subagents.upsertLink({
        runtimeId: "runtime-1",
        parentThreadId: "parent-thread",
        childThreadId: "child-thread",
        itemId: "spawn-1",
        status,
        ...(status === "error" ? { error: "First turn failed" } : {}),
      });

      const staleRunning = subagents.upsertLink({
        runtimeId: "runtime-1",
        parentThreadId: "parent-thread",
        childThreadId: "child-thread",
        itemId: "resume-1",
        status: "running",
        allowStatusRestart: true,
        startedAtMs: 200,
      });

      expect(staleRunning.status).toBe(status);
      if (status === "error") {
        expect(staleRunning.error).toBe("First turn failed");
      }
    }
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
