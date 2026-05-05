import { describe, expect, mock, test } from "bun:test";
import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentEnginePort, AgentSessionPresenceSnapshot } from "@openducktor/core";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import { prepareRepoSessionPresencePreloads } from "./repo-session-presence-preloads";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";

type ListSessionPresenceInput = Parameters<AgentEnginePort["listSessionPresence"]>[0];

const repoPath = "/tmp/repo";
const worktreeA = "/tmp/repo/worktree-a";
const worktreeB = "/tmp/repo/worktree-b";

const createRecord = ({
  externalSessionId,
  workingDirectory,
  runtimeKind = "opencode",
}: {
  externalSessionId: string;
  workingDirectory: string;
  runtimeKind?: RuntimeKind;
}): AgentSessionRecord => ({
  runtimeKind,
  externalSessionId,
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory,
  selectedModel: null,
});

const createRuntime = ({
  runtimeId = "runtime-1",
  runtimeKind = "opencode",
  runtimeRepoPath = repoPath,
}: {
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
  runtimeRepoPath?: string;
} = {}): RuntimeInstanceSummary => ({
  kind: runtimeKind,
  runtimeId,
  repoPath: runtimeRepoPath,
  taskId: null,
  role: "workspace",
  workingDirectory: runtimeRepoPath,
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4555",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const createPresence = ({
  externalSessionId,
  workingDirectory,
}: {
  externalSessionId: string;
  workingDirectory: string;
}): AgentSessionPresenceSnapshot =>
  createAgentSessionPresenceSnapshotFixture({
    ref: { externalSessionId, workingDirectory },
  });

describe("repo-session-presence-preloads", () => {
  test("loads runtime list once and scans normalized unique directories once per runtime kind", async () => {
    const runtime = createRuntime();
    const runtimeListCalls: Array<{ runtimeKind: RuntimeKind; repoPath: string }> = [];
    const presenceCalls: ListSessionPresenceInput[] = [];
    const worktreeAPresence = createPresence({
      externalSessionId: "external-a",
      workingDirectory: worktreeA,
    });
    const worktreeBPresence = createPresence({
      externalSessionId: "external-b",
      workingDirectory: worktreeB,
    });
    const outsidePresence = createPresence({
      externalSessionId: "external-outside",
      workingDirectory: "/tmp/repo/worktree-outside",
    });
    const stalePresence = {
      ...createPresence({ externalSessionId: "external-stale", workingDirectory: worktreeA }),
      presence: "stale" as const,
      classification: "stale" as const,
      runtimeId: null,
      pendingApprovals: [] as [],
      pendingQuestions: [] as [],
    } satisfies AgentSessionPresenceSnapshot;

    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [
        createRecord({ externalSessionId: "external-a", workingDirectory: `${worktreeA}/` }),
        createRecord({ externalSessionId: "external-a-duplicate", workingDirectory: worktreeA }),
        createRecord({ externalSessionId: "external-b", workingDirectory: worktreeB }),
      ],
      loadRuntimeList: mock(async (runtimeKind: RuntimeKind, loadedRepoPath: string) => {
        runtimeListCalls.push({ runtimeKind, repoPath: loadedRepoPath });
        return [runtime];
      }),
      listSessionPresence: mock(async (input: ListSessionPresenceInput) => {
        presenceCalls.push(input);
        return [worktreeAPresence, worktreeBPresence, outsidePresence, stalePresence];
      }),
    });

    expect(runtimeListCalls).toEqual([{ runtimeKind: "opencode", repoPath }]);
    expect(presenceCalls).toEqual([
      {
        repoPath,
        runtimeKind: "opencode",
        directories: [worktreeA, worktreeB],
      },
    ]);
    expect(result.preloadedRuntimeLists.get("opencode")).toBeArrayOfSize(1);
    expect(result.preloadedSessionPresenceByKey).toEqual(
      new Map([
        [agentSessionPresenceLookupKey(repoPath, "opencode", worktreeA), [worktreeAPresence]],
        [agentSessionPresenceLookupKey(repoPath, "opencode", worktreeB), [worktreeBPresence]],
      ]),
    );
  });

  test("keeps empty entries for scanned directories with no live sessions", async () => {
    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [createRecord({ externalSessionId: "external-a", workingDirectory: worktreeA })],
      loadRuntimeList: async () => [createRuntime()],
      listSessionPresence: async () => [],
    });

    expect(result.preloadedSessionPresenceByKey).toEqual(
      new Map([[agentSessionPresenceLookupKey(repoPath, "opencode", worktreeA), []]]),
    );
  });

  test("does not scan when no repo runtime matches but preserves runtime list for downstream resolution", async () => {
    const listSessionPresence = mock(async () => {
      throw new Error("should not scan without a matching repo runtime");
    });

    const result = await prepareRepoSessionPresencePreloads({
      repoPath,
      records: [createRecord({ externalSessionId: "external-a", workingDirectory: worktreeA })],
      loadRuntimeList: async () => [createRuntime({ runtimeRepoPath: "/tmp/other" })],
      listSessionPresence,
    });

    expect(result.preloadedRuntimeLists.get("opencode")).toBeArrayOfSize(1);
    expect(result.preloadedSessionPresenceByKey).toEqual(new Map());
    expect(listSessionPresence).not.toHaveBeenCalled();
  });

  test("propagates runtime-list and presence-scan errors", async () => {
    await expect(
      prepareRepoSessionPresencePreloads({
        repoPath,
        records: [createRecord({ externalSessionId: "external-a", workingDirectory: worktreeA })],
        loadRuntimeList: async () => {
          throw new Error("runtime list failed");
        },
        listSessionPresence: async () => [],
      }),
    ).rejects.toThrow("runtime list failed");

    await expect(
      prepareRepoSessionPresencePreloads({
        repoPath,
        records: [createRecord({ externalSessionId: "external-a", workingDirectory: worktreeA })],
        loadRuntimeList: async () => [createRuntime()],
        listSessionPresence: async () => {
          throw new Error("presence scan failed");
        },
      }),
    ).rejects.toThrow("presence scan failed");
  });
});
