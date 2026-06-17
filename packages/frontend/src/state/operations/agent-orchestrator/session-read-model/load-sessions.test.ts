import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createAgentSessionFixture, createDeferred } from "@/test-utils/shared-test-fixtures";
import { host } from "../../host";
import { createSessionMessagesState } from "../support/messages";
import { createLoadAgentSessions, loadRepoAgentSessionsForTasks } from "./load-sessions";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "Build the task from the repository rules.",
  status: "in_progress",
  priority: 1,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-06-12T08:00:00.000Z",
  createdAt: "2026-06-12T08:00:00.000Z",
};

const createLoaderHarness = ({
  initialSessionCollection = emptyAgentSessionCollection(),
  listSessionRuntimeSnapshots,
  tasks = [taskFixture],
  sessionRecordsByTaskId = { [taskFixture.id]: [record] },
  observedSessionKeys = new Set<string>(),
}: {
  initialSessionCollection?: AgentSessionCollection;
  listSessionRuntimeSnapshots: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["listSessionRuntimeSnapshots"];
  tasks?: TaskCard[];
  sessionRecordsByTaskId?: Record<string, AgentSessionRecord[]>;
  observedSessionKeys?: ReadonlySet<string>;
}) => {
  let sessionCollection = initialSessionCollection;
  const listenedSessions: AgentSessionRef[] = [];
  const cleanedSessions: AgentSessionRef[] = [];
  const queryClient = new QueryClient();
  host.agentSessionsList = async (_repoPath, taskId) => sessionRecordsByTaskId[taskId] ?? [];
  for (const task of tasks) {
    queryClient.setQueryData(
      agentSessionQueryKeys.list("/repo", task.id),
      sessionRecordsByTaskId[task.id] ?? [],
    );
  }
  const loadAgentSessions = createLoadAgentSessions({
    workspaceRepoPath: "/repo",
    adapter: {
      listSessionRuntimeSnapshots,
    },
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    commitSessionCollection: (commit) => {
      const { collection, result } = commit(sessionCollection);
      sessionCollection = collection;
      return result;
    },
    observeAgentSession: async (session) => {
      listenedSessions.push(session);
      return true;
    },
    getObservedSessionKeys: () => observedSessionKeys,
    cleanupLocalSessions: (sessions) => {
      cleanedSessions.push(...sessions);
    },
    queryClient,
  });

  return {
    loadAgentSessions,
    listenedSessions,
    cleanedSessions,
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
  };
};

describe("createLoadAgentSessions", () => {
  let originalAgentSessionsList: typeof host.agentSessionsList;

  beforeEach(() => {
    originalAgentSessionsList = host.agentSessionsList;
  });

  afterEach(() => {
    host.agentSessionsList = originalAgentSessionsList;
  });

  test("loads the repo read model from task session record queries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
    let sessionCollection = emptyAgentSessionCollection();
    let runtimeSnapshotReads = 0;

    await loadRepoAgentSessionsForTasks({
      repoPath: "/repo",
      tasks: [taskFixture],
      adapter: {
        listSessionRuntimeSnapshots: async () => {
          runtimeSnapshotReads += 1;
          return [];
        },
      },
      commitSessionCollection: ((commit) => {
        const { collection, result } = commit(sessionCollection);
        sessionCollection = collection;
        return result;
      }) satisfies AgentSessionsStore["commitSessionCollection"],
      observeAgentSession: async () => {
        throw new Error("No runtime sessions should be observed for missing runtime snapshot.");
      },
      getObservedSessionKeys: () => new Set(),
      cleanupLocalSessions: () => undefined,
      queryClient,
      isStaleRepoOperation: () => false,
    });

    expect(runtimeSnapshotReads).toBe(1);
    expect(
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === record.externalSessionId,
      ) ?? null,
    ).toEqual(
      expect.objectContaining({
        externalSessionId: record.externalSessionId,
        status: "idle",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    );
  });

  test("commits the repo session read model from one runtime snapshot scan", async () => {
    const harness = createLoaderHarness({
      listSessionRuntimeSnapshots: async () => [
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
      ],
    });

    await harness.loadAgentSessions("task-1");

    expect(harness.getSession("external-1")?.status).toBe("running");
    expect(harness.getSession("external-1")?.runtimeKind).toBe("opencode");
    expect(harness.listenedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
    ]);
  });

  test("waits for runtime snapshot before committing persisted session state", async () => {
    const runtimeSnapshotReady = createDeferred<void>();
    const harness = createLoaderHarness({
      listSessionRuntimeSnapshots: async () => {
        await runtimeSnapshotReady.promise;
        return [];
      },
    });

    const loading = harness.loadAgentSessions("task-1");

    expect(harness.getSession(record.externalSessionId)).toBeNull();

    runtimeSnapshotReady.resolve(undefined);
    await loading;

    const session = harness.getSession(record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.runtimeKind).toBe("opencode");
    expect(session?.workingDirectory).toBe(record.workingDirectory);
    expect(session?.historyLoadState).toBe("not_requested");
  });

  test("uses empty persisted task records as authoritative local session cleanup", async () => {
    let runtimeSnapshotReads = 0;
    const localSession = createAgentSessionFixture({
      externalSessionId: record.externalSessionId,
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "stopped",
      startedAt: record.startedAt,
      workingDirectory: record.workingDirectory,
    });
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([localSession]),
      listSessionRuntimeSnapshots: async () => {
        runtimeSnapshotReads += 1;
        return [];
      },
      sessionRecordsByTaskId: { [taskFixture.id]: [] },
    });

    await harness.loadAgentSessions("task-1");

    expect(harness.getSession(record.externalSessionId)).toBeNull();
    expect(harness.cleanedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: record.externalSessionId,
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      },
    ]);
    expect(runtimeSnapshotReads).toBe(0);
  });

  test("keeps observed mounted transcript and live state when runtime snapshot is missing during repo reloads", async () => {
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
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([mountedSession]),
      listSessionRuntimeSnapshots: async () => [],
      observedSessionKeys: new Set([agentSessionIdentityKey(mountedSession)]),
    });

    await harness.loadAgentSessions("task-1");

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to stay mounted.`);
    }
    expect(session.status).toBe("running");
    expect(session.historyLoadState).toBe("loaded");
    expect(session.pendingUserMessageStartedAt).toBe(123);
    expect(session.messages).toBe(mountedSession.messages);
    expect(harness.listenedSessions).toEqual([]);
  });
});
