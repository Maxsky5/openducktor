import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import { prepareRepoSessionPresencePreloads } from "./repo-session-presence-preloads";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

type ListSessionPresenceInput = Parameters<AgentEnginePort["listSessionPresence"]>[0];

const repoPath = "/tmp/repo";
const runtimeKind = "opencode" as const;

const createRecord = (externalSessionId: string, workingDirectory: string): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind,
  workingDirectory,
  selectedModel: null,
});

const createRuntimePresence = (externalSessionId: string, workingDirectory: string) =>
  createAgentSessionPresenceSnapshotFixture({
    ref: { repoPath, runtimeKind, externalSessionId, workingDirectory },
    snapshot: { workingDirectory },
  });

const createNonRuntimePresence = (externalSessionId: string, workingDirectory: string) =>
  toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref: { repoPath, runtimeKind, externalSessionId, workingDirectory },
    runtimeId: null,
    snapshot: null,
  });

describe("repo-session-presence-preloads", () => {
  test("batches listSessionPresence with unique normalized working directories", async () => {
    const listInputs: ListSessionPresenceInput[] = [];
    const listSessionPresence = mock(async (input: ListSessionPresenceInput) => {
      listInputs.push(input);
      return [];
    });

    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [
        createRecord("external-1", " /tmp/repo/worktree-a/ "),
        createRecord("external-2", "/tmp/repo/worktree-a"),
        createRecord("external-3", ""),
        createRecord("external-4", "   "),
        createRecord("external-5", "/tmp/repo/worktree-b//"),
      ],
      listSessionPresence,
    });

    expect(listSessionPresence).toHaveBeenCalledTimes(1);
    expect(listInputs).toEqual([
      {
        repoPath,
        runtimeKind,
        directories: ["/tmp/repo/worktree-a", "/tmp/repo/worktree-b"],
      },
    ]);
    expect(Array.from(result.preloadedSessionPresenceByKey.entries())).toEqual([
      [agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-a"), []],
      [agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-b"), []],
    ]);
  });

  test("stores empty authoritative entries for requested directories with no runtime presence", async () => {
    const listSessionPresence = mock(async () => [
      createNonRuntimePresence("external-1", "/tmp/repo/worktree-a"),
      createNonRuntimePresence("external-2", "/tmp/repo/worktree-b"),
    ]);

    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [
        createRecord("external-1", "/tmp/repo/worktree-a"),
        createRecord("external-2", "/tmp/repo/worktree-b"),
      ],
      listSessionPresence,
    });

    expect(
      result.preloadedSessionPresenceByKey.get(
        agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-a"),
      ),
    ).toEqual([]);
    expect(
      result.preloadedSessionPresenceByKey.get(
        agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-b"),
      ),
    ).toEqual([]);
  });

  test("filters non-runtime snapshots and snapshots outside requested directories", async () => {
    const requestedPresence = createRuntimePresence("external-1", "/tmp/repo/worktree-a");
    const outsidePresence = createRuntimePresence("external-2", "/tmp/repo/worktree-outside");
    const listSessionPresence = mock(async () => [
      createNonRuntimePresence("external-3", "/tmp/repo/worktree-b"),
      requestedPresence,
      outsidePresence,
    ]);

    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [
        createRecord("external-1", "/tmp/repo/worktree-a"),
        createRecord("external-3", "/tmp/repo/worktree-b"),
      ],
      listSessionPresence,
    });

    expect(
      result.preloadedSessionPresenceByKey.get(
        agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-a"),
      ),
    ).toEqual([requestedPresence]);
    expect(
      result.preloadedSessionPresenceByKey.get(
        agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-b"),
      ),
    ).toEqual([]);
    expect(
      result.preloadedSessionPresenceByKey.has(
        agentSessionPresenceLookupKey(repoPath, runtimeKind, "/tmp/repo/worktree-outside"),
      ),
    ).toBe(false);
  });
});
