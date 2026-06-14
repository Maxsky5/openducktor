import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createAgentSessionFixture, createDeferred } from "@/test-utils/shared-test-fixtures";
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
  listSessionPresence,
  tasks = [taskFixture],
  sessionRecordsByTaskId = { [taskFixture.id]: [record] },
}: {
  initialSessionCollection?: AgentSessionCollection;
  listSessionPresence: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["listSessionPresence"];
  tasks?: TaskCard[];
  sessionRecordsByTaskId?: Record<string, AgentSessionRecord[]>;
}) => {
  let sessionCollection: AgentSessionCollection = initialSessionCollection;
  const listenedSessions: AgentSessionRef[] = [];
  const queryClient = new QueryClient();
  for (const task of tasks) {
    queryClient.setQueryData(
      agentSessionQueryKeys.list("/repo", task.id),
      sessionRecordsByTaskId[task.id] ?? [],
    );
  }
  const loadAgentSessions = createLoadAgentSessions({
    activeWorkspace: {
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
      repoPath: "/repo",
    },
    adapter: {
      listSessionPresence,
    },
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    setSessionCollection: (updater) => {
      sessionCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
    },
    listenToAgentSession: async (session) => {
      listenedSessions.push(session);
    },
    queryClient,
  });

  return {
    loadAgentSessions,
    listenedSessions,
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
  };
};

describe("createLoadAgentSessions", () => {
  test("loads the repo read model from task session record queries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(agentSessionQueryKeys.bulk("/repo", ["task-1"]), {
      "task-1": [record],
    });
    let sessionCollection = emptyAgentSessionCollection();
    let presenceReads = 0;

    await loadRepoAgentSessionsForTasks({
      repoPath: "/repo",
      tasks: [taskFixture],
      adapter: {
        listSessionPresence: async () => {
          presenceReads += 1;
          return [];
        },
      },
      commitSessions: (updater) => {
        sessionCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
      },
      listenToAgentSession: async () => {
        throw new Error("No runtime sessions should be observed for missing presence.");
      },
      queryClient,
      isStaleRepoOperation: () => false,
    });

    expect(presenceReads).toBe(1);
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

  test("commits the repo session read model from one runtime presence scan", async () => {
    const harness = createLoaderHarness({
      listSessionPresence: async () => [
        toAgentSessionPresenceSnapshotFromLiveSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
            externalSessionId: "external-1",
          },
          snapshot: {
            externalSessionId: "external-1",
            title: "Builder",
            startedAt: "2026-06-12T08:00:00.000Z",
            status: { type: "busy" },
            workingDirectory: "/repo/worktree",
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

  test("waits for runtime presence before committing persisted session state", async () => {
    const presenceReady = createDeferred<void>();
    const harness = createLoaderHarness({
      listSessionPresence: async () => {
        await presenceReady.promise;
        return [];
      },
    });

    const loading = harness.loadAgentSessions("task-1");

    expect(harness.getSession(record.externalSessionId)).toBeNull();

    presenceReady.resolve(undefined);
    await loading;

    const session = harness.getSession(record.externalSessionId);
    expect(session?.status).toBe("idle");
    expect(session?.runtimeKind).toBe("opencode");
    expect(session?.workingDirectory).toBe(record.workingDirectory);
    expect(session?.historyLoadState).toBe("not_requested");
  });

  test("commits an empty persisted read model after task session records are removed", async () => {
    let presenceReads = 0;
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([
        createAgentSessionFixture({
          externalSessionId: record.externalSessionId,
          taskId: "task-1",
          runtimeKind: "opencode",
          role: "build",
          status: "stopped",
          startedAt: record.startedAt,
          workingDirectory: record.workingDirectory,
        }),
      ]),
      listSessionPresence: async () => {
        presenceReads += 1;
        return [];
      },
      sessionRecordsByTaskId: { [taskFixture.id]: [] },
    });

    await harness.loadAgentSessions("task-1");

    expect(harness.getSession(record.externalSessionId)).toBeNull();
    expect(presenceReads).toBe(0);
  });

  test("keeps mounted transcript but clears runtime state when presence is missing during repo reloads", async () => {
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
      listSessionPresence: async () => [],
    });

    await harness.loadAgentSessions("task-1");

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to stay mounted.`);
    }
    expect(session.status).toBe("idle");
    expect(session.historyLoadState).toBe("loaded");
    expect(session.messages).toBe(mountedSession.messages);
    expect(harness.listenedSessions).toEqual([]);
  });
});
