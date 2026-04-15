import { describe, expect, test } from "bun:test";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import { LiveAgentSessionStore } from "./live-agent-session-store";

const localRuntimeConnection: AgentRuntimeConnection = {
  type: "local_http",
  endpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/runtime-root",
};

const stdioRuntimeConnection: AgentRuntimeConnection = {
  type: "stdio",
  workingDirectory: "/tmp/runtime-root/",
};

const createSnapshot = (
  externalSessionId: string,
  workingDirectory: string,
): LiveAgentSessionSnapshot => ({
  externalSessionId,
  title: `Session ${externalSessionId}`,
  workingDirectory,
  startedAt: "2026-02-22T08:00:00.000Z",
  status: { type: "busy" },
  pendingPermissions: [],
  pendingQuestions: [],
});

describe("live-agent-session-store", () => {
  test("returns matching snapshots for the same repo and lookup key", () => {
    const store = new LiveAgentSessionStore();
    const expectedSnapshot = createSnapshot("external-1", "/tmp/repo/worktree");

    store.replaceRepoSnapshots(
      "/tmp/repo",
      new Map([
        [
          liveAgentSessionLookupKey("opencode", localRuntimeConnection, "/tmp/repo/worktree/"),
          [expectedSnapshot],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: localRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "external-1",
        nowMs: 5_500,
      }),
    ).toEqual(expectedSnapshot);
  });

  test("treats repo snapshots as isolated and clearable", () => {
    const store = new LiveAgentSessionStore();
    const repoOneSnapshot = createSnapshot("external-1", "/tmp/repo-one/worktree");

    store.replaceRepoSnapshots(
      "/tmp/repo-one",
      new Map([
        [
          liveAgentSessionLookupKey("opencode", localRuntimeConnection, "/tmp/repo-one/worktree"),
          [repoOneSnapshot],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo-two",
        runtimeKind: "opencode",
        runtimeConnection: localRuntimeConnection,
        workingDirectory: "/tmp/repo-one/worktree",
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();

    store.clearRepo("/tmp/repo-one");

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo-one",
        runtimeKind: "opencode",
        runtimeConnection: localRuntimeConnection,
        workingDirectory: "/tmp/repo-one/worktree",
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });

  test("expires stale snapshots using the default or provided max age", () => {
    const store = new LiveAgentSessionStore();
    const snapshot = createSnapshot("external-1", "/tmp/repo/worktree");

    store.replaceRepoSnapshots(
      "/tmp/repo",
      new Map([
        [
          liveAgentSessionLookupKey("opencode", stdioRuntimeConnection, "/tmp/repo/worktree"),
          [snapshot],
        ],
      ]),
      10_000,
    );

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree/",
        externalSessionId: "external-1",
        nowMs: 15_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree/",
        externalSessionId: "external-1",
        nowMs: 15_001,
      }),
    ).toBeNull();

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree/",
        externalSessionId: "external-1",
        maxAgeMs: 10_000,
        nowMs: 20_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: stdioRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree/",
        externalSessionId: "external-1",
        maxAgeMs: 9_999,
        nowMs: 20_000,
      }),
    ).toBeNull();
  });

  test("returns null when the external session id is not present in the matched snapshot list", () => {
    const store = new LiveAgentSessionStore();

    store.replaceRepoSnapshots(
      "/tmp/repo",
      new Map([
        [
          liveAgentSessionLookupKey("opencode", localRuntimeConnection, "/tmp/repo/worktree"),
          [createSnapshot("external-1", "/tmp/repo/worktree")],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeConnection: localRuntimeConnection,
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "missing",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });
});
