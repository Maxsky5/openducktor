import { describe, expect, test } from "bun:test";
import type { LiveSessionTruth } from "@openducktor/core";
import { createLiveSessionTruthFixture } from "../test-utils";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import { LiveAgentSessionStore } from "./live-agent-session-store";

const repoPath = "/tmp/repo";
const repoTwoPath = "/tmp/repo-two";
const workingDirectory = "/tmp/repo/worktree";
const repoOneWorkingDirectory = "/tmp/repo-one/worktree";

const createTruth = (externalSessionId: string, workingDirectory: string): LiveSessionTruth =>
  createLiveSessionTruthFixture({ ref: { externalSessionId, workingDirectory } });

describe("live-agent-session-store", () => {
  test("returns matching snapshots for the same repo and lookup key", () => {
    const store = new LiveAgentSessionStore();
    const expectedTruth = createTruth("external-1", workingDirectory);

    store.replaceRepoTruths(
      repoPath,
      new Map([
        [liveAgentSessionLookupKey(repoPath, "opencode", `${workingDirectory}/`), [expectedTruth]],
      ]),
      1_000,
    );

    expect(
      store.readTruth({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "external-1",
        nowMs: 5_500,
      }),
    ).toEqual(expectedTruth);
  });

  test("treats repo snapshots as isolated and clearable", () => {
    const store = new LiveAgentSessionStore();
    const repoOneTruth = createTruth("external-1", repoOneWorkingDirectory);

    store.replaceRepoTruths(
      "/tmp/repo-one",
      new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo-one", "opencode", repoOneWorkingDirectory),
          [repoOneTruth],
        ],
      ]),
      1_000,
    );

    expect(
      store.readTruth({
        repoPath: repoTwoPath,
        runtimeKind: "opencode",
        workingDirectory: repoOneWorkingDirectory,
        externalSessionId: "external-1",
        nowMs: 1_500,
      }),
    ).toBeNull();

    store.clearRepo("/tmp/repo-one");

    expect(
      store.readTruth({
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
    const truth = createTruth("external-1", workingDirectory);

    store.replaceRepoTruths(
      repoPath,
      new Map([[liveAgentSessionLookupKey(repoPath, "opencode", workingDirectory), [truth]]]),
      10_000,
    );

    expect(
      store.readTruth({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_000,
      }),
    ).toEqual(truth);

    expect(
      store.readTruth({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        nowMs: 15_001,
      }),
    ).toBeNull();

    expect(
      store.readTruth({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory: `${workingDirectory}/`,
        externalSessionId: "external-1",
        maxAgeMs: 10_000,
        nowMs: 20_000,
      }),
    ).toEqual(truth);

    expect(
      store.readTruth({
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

    store.replaceRepoTruths(
      repoPath,
      new Map([
        [
          liveAgentSessionLookupKey(repoPath, "opencode", workingDirectory),
          [createTruth("external-1", workingDirectory)],
        ],
      ]),
      1_000,
    );

    expect(
      store.readTruth({
        repoPath,
        runtimeKind: "opencode",
        workingDirectory,
        externalSessionId: "missing",
        nowMs: 1_500,
      }),
    ).toBeNull();
  });
});
