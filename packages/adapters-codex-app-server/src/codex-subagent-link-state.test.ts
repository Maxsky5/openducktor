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
    ]);
    expect(subagents.statusForChild("linked-child", "runtime-1")).toBe("running");
    expect(
      subagents.failUnlinkedSpawnsForParent("parent-thread", "runtime-2", "Other failure"),
    ).toHaveLength(1);
  });
});
