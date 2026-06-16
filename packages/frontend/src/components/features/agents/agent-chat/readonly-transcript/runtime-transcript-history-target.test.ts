import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { resolveRuntimeTranscriptHistoryTarget } from "./runtime-transcript-history-target";

const target: AgentSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a/worktree",
};

describe("resolveRuntimeTranscriptHistoryTarget", () => {
  test("uses a matching live session instead of loading history", () => {
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
      status: "running",
    });

    const historyTarget = resolveRuntimeTranscriptHistoryTarget({
      isOpen: true,
      repoPath: "/repo-a",
      target,
      repoReadinessState: "ready",
      liveSession,
    });

    expect(historyTarget).toEqual({ kind: "live", session: liveSession });
  });

  test("builds a runtime history ref for an unloaded target once runtime is ready", () => {
    const historyTarget = resolveRuntimeTranscriptHistoryTarget({
      isOpen: true,
      repoPath: "/repo-a",
      target,
      repoReadinessState: "ready",
      liveSession: null,
    });

    expect(historyTarget).toEqual({
      kind: "history",
      sessionRef: {
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      },
      canReadHistory: true,
    });
  });

  test("keeps history loading disabled while runtime readiness is unresolved", () => {
    const historyTarget = resolveRuntimeTranscriptHistoryTarget({
      isOpen: true,
      repoPath: "/repo-a",
      target,
      repoReadinessState: "checking",
      liveSession: null,
    });

    expect(historyTarget).toEqual({
      kind: "history",
      sessionRef: {
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      },
      canReadHistory: false,
    });
  });

  test("ignores a same-id live session from another working directory", () => {
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-b/worktree",
      status: "running",
    });

    const historyTarget = resolveRuntimeTranscriptHistoryTarget({
      isOpen: true,
      repoPath: "/repo-a",
      target,
      repoReadinessState: "ready",
      liveSession,
    });

    expect(historyTarget).toEqual({
      kind: "history",
      sessionRef: {
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      },
      canReadHistory: true,
    });
  });

  test("has no history target while the dialog is closed", () => {
    const historyTarget = resolveRuntimeTranscriptHistoryTarget({
      isOpen: false,
      repoPath: "/repo-a",
      target,
      repoReadinessState: "ready",
      liveSession: null,
    });

    expect(historyTarget).toEqual({ kind: "none" });
  });
});
