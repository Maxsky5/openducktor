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
});
