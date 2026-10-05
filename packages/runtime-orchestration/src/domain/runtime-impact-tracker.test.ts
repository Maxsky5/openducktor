import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot, RuntimeKind } from "@openducktor/contracts";
import { createRuntimeImpactTracker } from "./runtime-impact-tracker";

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
  runtimeKind: RuntimeKind = "codex",
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo-a",
    runtimeKind,
    workingDirectory: "/repo-a/worktree",
    externalSessionId,
  },
  activity: "running",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-10-03T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

describe("createRuntimeImpactTracker", () => {
  test("signals a new session and a reviewed field change, but not context progress", () => {
    const track = createRuntimeImpactTracker();

    expect(track({ type: "session_upsert", session: snapshot("session-1") })).toEqual(["codex"]);
    expect(track({ type: "session_upsert", session: snapshot("session-1") })).toEqual([]);
    expect(
      track({
        type: "session_upsert",
        session: snapshot("session-1", {
          contextUsage: { totalTokens: 10, providerId: "openai", modelId: "gpt" },
        }),
      }),
    ).toEqual([]);
    expect(
      track({ type: "session_upsert", session: snapshot("session-1", { activity: "idle" }) }),
    ).toEqual(["codex"]);
  });

  test("signals a removed session once", () => {
    const track = createRuntimeImpactTracker();
    track({ type: "session_upsert", session: snapshot("session-1") });

    expect(track({ type: "session_removed", ref: snapshot("session-1").ref })).toEqual(["codex"]);
    expect(track({ type: "session_removed", ref: snapshot("session-1").ref })).toEqual([]);
  });

  test("drops only the unlisted sessions of the snapshot repository", () => {
    const track = createRuntimeImpactTracker();
    track({ type: "session_upsert", session: snapshot("session-1") });

    expect(track({ type: "snapshot", repoPath: "/repo-b", sessions: [] })).toEqual([]);
    expect(
      track({ type: "snapshot", repoPath: "/repo-a", sessions: [snapshot("session-1")] }),
    ).toEqual([]);
    expect(track({ type: "snapshot", repoPath: "/repo-a", sessions: [] })).toEqual(["codex"]);
    expect(track({ type: "session_removed", ref: snapshot("session-1").ref })).toEqual([]);
  });

  test("reports each changed runtime kind of a snapshot once", () => {
    const track = createRuntimeImpactTracker();

    expect(
      track({
        type: "snapshot",
        repoPath: "/repo-a",
        sessions: [
          snapshot("session-1"),
          snapshot("session-2"),
          snapshot("session-3", {}, "opencode"),
        ],
      }),
    ).toEqual(["codex", "opencode"]);
  });

  test("ignores envelopes that carry no session change", () => {
    const track = createRuntimeImpactTracker();

    expect(
      track({ type: "fault", repoPath: "/repo-a", operation: "test", message: "lost" }),
    ).toEqual([]);
  });
});
