import { describe, expect, test } from "bun:test";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";
import { AgentSessionPresenceStore } from "./session-presence-store";

const repoPath = "/tmp/repo";
const repoTwoPath = "/tmp/repo-two";
const workingDirectory = "/tmp/repo/worktree";
const repoOneWorkingDirectory = "/tmp/repo-one/worktree";

const createPresence = (
  externalSessionId: string,
  workingDirectory: string,
): AgentSessionPresenceSnapshot =>
  createAgentSessionPresenceSnapshotFixture({ ref: { externalSessionId, workingDirectory } });

describe("session-presence-store", () => {
  test("returns matching snapshots for the same repo and lookup key", () => {
    const store = new AgentSessionPresenceStore();
    const expectedPresence = createPresence("external-1", workingDirectory);

    store.replaceRepoPresence(
      repoPath,
      new Map([
        [
          agentSessionPresenceLookupKey(repoPath, "opencode", `${workingDirectory}/`),
          [expectedPresence],
        ],
      ]),
      1_000,
    );

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
        nowMs: 5_500,
      }),
    ).toEqual(expectedPresence);
  });

  test("normalizes repo buckets for equivalent repo paths", () => {
    const store = new AgentSessionPresenceStore();
    const expectedPresence = createPresence("external-1", workingDirectory);

    store.replaceRepoPresence(
      `${repoPath}/`,
      new Map([
        [agentSessionPresenceLookupKey(repoPath, "opencode", workingDirectory), [expectedPresence]],
      ]),
      1_000,
    );

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toEqual(expectedPresence);

    store.clearRepo(repoPath);

    expect(
      store.readPresence({
        repoPath: `${repoPath}/`,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });

  test("treats repo snapshots as isolated and clearable", () => {
    const store = new AgentSessionPresenceStore();
    const repoOnePresence = createPresence("external-1", repoOneWorkingDirectory);

    store.replaceRepoPresence(
      "/tmp/repo-one",
      new Map([
        [
          agentSessionPresenceLookupKey("/tmp/repo-one", "opencode", repoOneWorkingDirectory),
          [repoOnePresence],
        ],
      ]),
      1_000,
    );

    expect(
      store.readPresence({
        repoPath: repoTwoPath,
        runtimeKind: "opencode",
        workingDirectory: repoOneWorkingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();

    store.clearRepo("/tmp/repo-one");

    expect(
      store.readPresence({
        repoPath: "/tmp/repo-one",
        runtimeKind: "opencode",
        workingDirectory: repoOneWorkingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });

  test("expires stale snapshots using the default or provided max age", () => {
    const store = new AgentSessionPresenceStore();
    const snapshot = createPresence("external-1", workingDirectory);

    store.replaceRepoPresence(
      repoPath,
      new Map([
        [agentSessionPresenceLookupKey(repoPath, "opencode", workingDirectory), [snapshot]],
      ]),
      10_000,
    );

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_001,
      }),
    ).toBeNull();

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        maxAgeMs: 10_000,
        nowMs: 20_000,
      }),
    ).toEqual(snapshot);

    expect(
      store.readPresence({
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
    const store = new AgentSessionPresenceStore();

    store.replaceRepoPresence(
      repoPath,
      new Map([
        [
          agentSessionPresenceLookupKey(repoPath, "opencode", workingDirectory),
          [createPresence("external-1", workingDirectory)],
        ],
      ]),
      1_000,
    );

    expect(
      store.readPresence({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "missing",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });
});
