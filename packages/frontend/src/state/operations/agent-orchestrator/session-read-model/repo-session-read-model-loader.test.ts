import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesState } from "../support/messages";
import { loadRepoSessionReadModel } from "./repo-session-read-model-loader";
import type { TaskSessionRecords } from "./task-session-records";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const taskSessionRecords: TaskSessionRecords = {
  taskIds: ["task-1"],
  records: [{ taskId: "task-1", record }],
};

const createCommitSessionCollection = (
  initialSessionCollection = emptyAgentSessionCollection(),
) => {
  let sessionCollection = initialSessionCollection;

  return {
    commitSessionCollection: ((commit) => {
      const { collection, result } = commit(sessionCollection);
      sessionCollection = collection;
      return result;
    }) satisfies AgentSessionsStore["commitSessionCollection"],
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
    listSessions: () => listAgentSessions(sessionCollection),
  };
};

const loadReadModel = async ({
  initialSessionCollection,
  listSessionRuntimeSnapshots,
  observeAgentSession = async () => undefined,
  clearSessionObservationState = () => undefined,
}: {
  initialSessionCollection?: AgentSessionCollection;
  listSessionRuntimeSnapshots: () => Promise<
    Awaited<ReturnType<typeof toAgentSessionRuntimeSnapshot>>[]
  >;
  observeAgentSession?: (session: AgentSessionRef) => Promise<void>;
  clearSessionObservationState?: (sessions: readonly AgentSessionRef[]) => void;
}) => {
  const collection = createCommitSessionCollection(initialSessionCollection);
  const result = await loadRepoSessionReadModel({
    repoPath: "/repo",
    taskSessionRecords,
    adapter: {
      listSessionRuntimeSnapshots: async () => listSessionRuntimeSnapshots(),
    },
    commitSessionCollection: collection.commitSessionCollection,
    observeAgentSession,
    clearSessionObservationState,
    isStaleRepoOperation: () => false,
  });

  return { ...collection, result };
};

describe("repo session read model loader", () => {
  test("commits persisted sessions with one runtime snapshot scan", async () => {
    let runtimeSnapshotReads = 0;
    const observedSessions: AgentSessionRef[] = [];
    const harness = await loadReadModel({
      listSessionRuntimeSnapshots: async () => {
        runtimeSnapshotReads += 1;
        return [
          toAgentSessionRuntimeSnapshot({
            ref: {
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "external-1",
            },
            snapshot: {
              title: "Builder",
              startedAt: "2026-06-12T08:00:00.000Z",
              runtimeActivity: "running",
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
        ];
      },
      observeAgentSession: async (session) => {
        observedSessions.push(session);
      },
    });

    expect(harness.result).toBe(true);
    expect(runtimeSnapshotReads).toBe(1);
    expect(harness.getSession("external-1")).toEqual(
      expect.objectContaining({
        externalSessionId: "external-1",
        status: "running",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    );
    expect(observedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
    ]);
  });

  test("clears observations for mounted sessions no longer listed by persistence", async () => {
    const cleanedSessions: AgentSessionRef[] = [];
    const removedSession = createAgentSessionFixture({
      externalSessionId: "removed-session",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      workingDirectory: "/repo/old-worktree",
    });

    await loadReadModel({
      initialSessionCollection: createAgentSessionCollection([removedSession]),
      listSessionRuntimeSnapshots: async () => [],
      clearSessionObservationState: (sessions) => {
        cleanedSessions.push(...sessions);
      },
    });

    expect(cleanedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "removed-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo/old-worktree",
      },
    ]);
  });

  test("settles mounted live state without clearing transcript when runtime snapshot is missing", async () => {
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
      pendingUserMessageStartedAt: 123,
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "streamed-message",
          role: "assistant",
          content: "Already visible",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ]),
    };
    const harness = await loadReadModel({
      initialSessionCollection: createAgentSessionCollection([mountedSession]),
      listSessionRuntimeSnapshots: async () => [],
    });
    const session = harness.getSession(record.externalSessionId);

    expect(session?.status).toBe("idle");
    expect(session?.historyLoadState).toBe("loaded");
    expect(session?.pendingUserMessageStartedAt).toBeUndefined();
    expect(session?.messages).toBe(mountedSession.messages);
  });
});
