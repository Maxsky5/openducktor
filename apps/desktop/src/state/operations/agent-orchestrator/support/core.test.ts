import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  READ_ONLY_ROLES,
  createRepoStaleGuard,
  isDuplicateAssistantMessage,
  runningStates,
  shouldReattachListenerForAttachedSession,
  throwIfRepoStale,
  toBaseUrl,
} from "./core";

describe("agent-orchestrator/support/core", () => {
  test("exposes expected role and runtime constants", () => {
    expect(READ_ONLY_ROLES.has("spec")).toBe(true);
    expect(READ_ONLY_ROLES.has("build")).toBe(false);
    expect(runningStates.has("running")).toBe(true);
    expect(runningStates.has("closed")).toBe(false);
    expect(toBaseUrl(4444)).toBe("http://127.0.0.1:4444");
  });

  test("detects duplicate assistant messages with timestamp tolerance", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Done",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
    ];

    expect(isDuplicateAssistantMessage(messages, "Done", "2026-02-22T08:00:01.500Z")).toBe(true);
    expect(isDuplicateAssistantMessage(messages, "Different", "2026-02-22T08:00:01.500Z")).toBe(
      false,
    );
  });

  test("reattaches listener only for non-error attached sessions", () => {
    expect(shouldReattachListenerForAttachedSession("running", false)).toBe(true);
    expect(shouldReattachListenerForAttachedSession("idle", true)).toBe(false);
    expect(shouldReattachListenerForAttachedSession("error", false)).toBe(false);
  });

  test("creates a stale-repo guard bound to initial repo epoch", () => {
    const repoEpochRef = { current: 3 };
    const previousRepoRef = { current: "/repo/a" as string | null };
    const isStale = createRepoStaleGuard({
      repoPath: "/repo/a",
      repoEpochRef,
      previousRepoRef,
    });

    expect(isStale()).toBe(false);
    repoEpochRef.current = 4;
    expect(isStale()).toBe(true);
  });

  test("throws when stale guard reports changed repo", () => {
    expect(() => throwIfRepoStale(() => false, "stale")).not.toThrow();
    expect(() => throwIfRepoStale(() => true, "stale")).toThrow("stale");
  });
});
