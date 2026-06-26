import { describe, expect, test } from "bun:test";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";

describe("CodexSubagentLinkState", () => {
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
