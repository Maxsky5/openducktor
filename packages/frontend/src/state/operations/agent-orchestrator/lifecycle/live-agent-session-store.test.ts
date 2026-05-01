import { describe, expect, test } from "bun:test";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import { createLiveAgentSessionSnapshotFixture } from "../test-utils";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import { LiveAgentSessionStore } from "./live-agent-session-store";

const repoPath = "/tmp/repo";
const repoTwoPath = "/tmp/repo-two";
const workingDirectory = "/tmp/repo/worktree";
const repoOneWorkingDirectory = "/tmp/repo-one/worktree";

const createSnapshot = (
  externalSessionId: string,
  workingDirectory: string,
): LiveAgentSessionSnapshot =>
  createLiveAgentSessionSnapshotFixture({ externalSessionId, workingDirectory });

describe("live-agent-session-store", () => {
  test("returns matching snapshots for the same repo and lookup key", () => {
    const store = new LiveAgentSessionStore();
    const expectedSnapshot = createSnapshot("external-1", workingDirectory);

    store.replaceRepoSnapshots(
      repoPath,
      new Map([
        [
          liveAgentSessionLookupKey(repoPath, "opencode", `${workingDirectory}/`),
          [expectedSnapshot],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
        nowMs: 5_500,
      }),
    ).toEqual(expectedSnapshot);
  });

  test("treats repo snapshots as isolated and clearable", () => {
    const store = new LiveAgentSessionStore();
    const repoOneSnapshot = createSnapshot("external-1", repoOneWorkingDirectory);

    store.replaceRepoSnapshots(
      "/tmp/repo-one",
      new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo-one", "opencode", repoOneWorkingDirectory),
          [repoOneSnapshot],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath: repoTwoPath,
        runtimeKind: "opencode",
        workingDirectory: repoOneWorkingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();

    store.clearRepo("/tmp/repo-one");

    expect(
      store.readSnapshot({
        repoPath: "/tmp/repo-one",
        runtimeKind: "opencode",
        workingDirectory: repoOneWorkingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });

  test("expires stale snapshots using the default or provided max age", () => {
    const store = new LiveAgentSessionStore();
    const snapshot = createSnapshot("external-1", workingDirectory);

    store.replaceRepoSnapshots(
      repoPath,
      new Map([[liveAgentSessionLookupKey(repoPath, "opencode", workingDirectory), [snapshot]]]),
      10_000,
    );

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_001,
      }),
    ).toBeNull();

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        maxAgeMs: 10_000,
        nowMs: 20_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        maxAgeMs: 9_999,
        nowMs: 20_000,
      }),
    ).toBeNull();
  });

  test("returns null when the external session id is not present in the matched snapshot list", () => {
    const store = new LiveAgentSessionStore();

    store.replaceRepoSnapshots(
      repoPath,
      new Map([
        [
          liveAgentSessionLookupKey(repoPath, "opencode", workingDirectory),
          [createSnapshot("external-1", workingDirectory)],
        ],
      ]),
      1_000,
    );

    expect(
      store.readSnapshot({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "missing",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });
});
