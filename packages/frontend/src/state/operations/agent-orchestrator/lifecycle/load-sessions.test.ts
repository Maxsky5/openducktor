import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
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
  loadSessionHistory = async () => [],
  tasks = [taskFixture],
  sessionRecordsByTaskId = { [taskFixture.id]: [record] },
  loadRepoPromptOverrides = async () => ({}),
}: {
  initialSessionCollection?: AgentSessionCollection;
  listSessionPresence: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["listSessionPresence"];
  loadSessionHistory?: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["loadSessionHistory"];
  tasks?: TaskCard[];
  sessionRecordsByTaskId?: Record<string, AgentSessionRecord[]>;
  loadRepoPromptOverrides?: (workspaceId: string) => Promise<RepoPromptOverrides>;
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
      loadSessionHistory,
    },
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    sessionsRef: {
      get current() {
        return sessionCollection;
      },
    },
    setSessionCollection: (updater) => {
      sessionCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
    },
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionCollection, identity);
      if (!current) {
        return;
      }
      sessionCollection = replaceAgentSession(sessionCollection, updater(current));
    },
    listenToAgentSession: async (session) => {
      listenedSessions.push(session);
    },
    queryClient,
    taskRef: { current: tasks },
    loadRepoPromptOverrides,
  });

  return {
    loadAgentSessions,
    listenedSessions,
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
    setSessions: (updater: (current: AgentSessionCollection) => AgentSessionCollection) => {
      sessionCollection = updater(sessionCollection);
    },
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
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Workspace",
        repoPath: "/repo",
      },
      repoPath: "/repo",
      tasks: [taskFixture],
      adapter: {
        listSessionPresence: async () => {
          presenceReads += 1;
          return [];
        },
        loadSessionHistory: async () => [],
      },
      commitSessions: (updater) => {
        sessionCollection = typeof updater === "function" ? updater(sessionCollection) : updater;
      },
      updateSession: (identity, updater) => {
        const current = getAgentSession(sessionCollection, identity);
        if (!current) {
          return;
        }
        sessionCollection = replaceAgentSession(sessionCollection, updater(current));
      },
      listenToAgentSession: async () => {
        throw new Error("No runtime sessions should be observed for missing presence.");
      },
      sessionsRef: {
        get current() {
          return sessionCollection;
        },
      },
      queryClient,
      loadRepoPromptOverrides: async () => ({}),
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
        status: "stopped",
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

  test("loads history only for an explicit requested session", async () => {
    let historyLoads = 0;
    const harness = createLoaderHarness({
      listSessionPresence: async () => [],
      loadSessionHistory: async () => {
        historyLoads += 1;
        return [];
      },
    });

    await harness.loadAgentSessions("task-1", {
      historyTargetSession: {
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
    });

    expect(historyLoads).toBe(1);
    expect(harness.getSession("external-1")?.historyLoadState).toBe("loaded");
  });

  test("fails explicit history loading for an unknown session", async () => {
    const harness = createLoaderHarness({
      listSessionPresence: async () => [],
      loadSessionHistory: async () => {
        throw new Error("History must not load for an unknown session.");
      },
    });

    await expect(
      harness.loadAgentSessions("task-1", {
        historyTargetSession: {
          externalSessionId: "missing-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      }),
    ).rejects.toThrow("Cannot load history for unknown session 'missing-session'.");
  });

  test("waits for runtime presence before committing persisted session state", async () => {
    const presenceReady = createDeferred<void>();
    const harness = createLoaderHarness({
      listSessionPresence: async () => {
        await presenceReady.promise;
        return [];
      },
      loadSessionHistory: async () => {
        throw new Error("History must wait for the runtime presence plan.");
      },
    });

    const loading = harness.loadAgentSessions("task-1");

    expect(harness.getSession(record.externalSessionId)).toBeNull();

    presenceReady.resolve(undefined);
    await loading;

    const session = harness.getSession(record.externalSessionId);
    expect(session?.status).toBe("stopped");
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

  test("loads the runtime history baseline for a running session after reload", async () => {
    let historyLoads = 0;
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
      loadSessionHistory: async () => {
        historyLoads += 1;
        return [
          {
            messageId: "history-system-1",
            role: "system",
            timestamp: "2026-06-12T08:00:00.000Z",
            text: "System prompt:\n\nBuild the task from the repository rules.",
            parts: [],
          },
          {
            messageId: "history-1",
            role: "assistant",
            timestamp: "2026-06-12T08:00:01.000Z",
            text: "Previous transcript",
            parts: [],
          },
        ];
      },
    });

    await harness.loadAgentSessions("task-1");

    const session = harness.getSession("external-1");
    if (!session) {
      throw new Error("Expected external-1 to be loaded");
    }
    expect(session.status).toBe("running");
    expect(session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "System prompt:\n\nBuild the task from the repository rules.",
      "Previous transcript",
    ]);
    expect(historyLoads).toBe(1);
    expect(harness.listenedSessions).toHaveLength(1);
  });

  test("does not erase a live user message that arrives while the repo read model is loading", async () => {
    const presenceReady = createDeferred<void>();
    let historyLoads = 0;
    const harness = createLoaderHarness({
      listSessionPresence: async () => {
        await presenceReady.promise;
        return [
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
        ];
      },
      loadSessionHistory: async () => {
        historyLoads += 1;
        return [
          {
            messageId: "history-1",
            role: "assistant",
            timestamp: "2026-06-12T08:00:00.500Z",
            text: "Previous transcript",
            parts: [],
          },
        ];
      },
    });

    const loading = harness.loadAgentSessions("task-1");
    harness.setSessions((current) =>
      replaceAgentSession(current, {
        ...createAgentSessionFixture({
          externalSessionId: record.externalSessionId,
          taskId: "task-1",
          runtimeKind: "opencode",
          role: "build",
          status: "running",
          startedAt: record.startedAt,
          workingDirectory: record.workingDirectory,
          historyLoadState: "not_requested",
        }),
        messages: createSessionMessagesState(record.externalSessionId, [
          {
            id: "runtime-user-new",
            role: "user",
            content: "Resume after QA rejection",
            timestamp: "2026-06-12T08:00:01.000Z",
            meta: {
              kind: "user",
              state: "queued",
              parts: [{ kind: "text", text: "Resume after QA rejection" }],
            },
          },
        ]),
      }),
    );
    presenceReady.resolve(undefined);
    await loading;

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be loaded.`);
    }
    expect(session.status).toBe("running");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Previous transcript",
      "Resume after QA rejection",
    ]);
    expect(historyLoads).toBe(1);
  });

  test("passes recomputed prompt context to loaded Codex history without persisting it", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    let receivedSystemPrompt: string | undefined;
    const harness = createLoaderHarness({
      listSessionPresence: async () => [
        toAgentSessionPresenceSnapshotFromLiveSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "codex",
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
      loadSessionHistory: async (input) => {
        receivedSystemPrompt = input.systemPromptContext?.systemPrompt;
        return [
          {
            messageId: "runtime-system-1",
            role: "system",
            timestamp: input.systemPromptContext?.startedAt ?? "2026-06-12T08:00:00.000Z",
            text: `System prompt:\n\n${input.systemPromptContext?.systemPrompt ?? ""}`,
            parts: [],
          },
          {
            messageId: "history-1",
            role: "assistant",
            timestamp: "2026-06-12T08:00:01.000Z",
            text: "Loaded from runtime history",
            parts: [],
          },
        ];
      },
      loadRepoPromptOverrides: async () => ({}),
      sessionRecordsByTaskId: { [taskFixture.id]: [codexRecord] },
    });

    await harness.loadAgentSessions("task-1");

    const session = harness.getSession("external-1");
    if (!session) {
      throw new Error("Expected external-1 to be loaded");
    }
    expect(receivedSystemPrompt).toContain("Task context");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      expect.stringContaining("System prompt:\n\n"),
      "Loaded from runtime history",
    ]);
  });

  test("does not replace live context stats with an older history baseline", async () => {
    const liveContextUsage = {
      totalTokens: 777,
      contextWindow: 4_000,
      providerId: "live-provider",
      modelId: "live-model",
    };
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        title: "Builder",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "not_requested",
        contextUsage: liveContextUsage,
      }),
      messages: createSessionMessagesState(record.externalSessionId, []),
    };
    const harness = createLoaderHarness({
      initialSessionCollection: createAgentSessionCollection([mountedSession]),
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
      loadSessionHistory: async () => [
        {
          messageId: "history-1",
          role: "assistant",
          timestamp: "2026-06-12T08:00:01.000Z",
          text: "Previous transcript",
          totalTokens: 123,
          contextWindow: 1_000,
          parts: [
            {
              kind: "step",
              messageId: "history-1",
              partId: "finish-1",
              phase: "finish",
              reason: "stop",
            },
          ],
        },
      ],
    });

    await harness.loadAgentSessions("task-1");

    expect(harness.getSession("external-1")?.historyLoadState).toBe("loaded");
    expect(harness.getSession("external-1")?.contextUsage).toEqual(liveContextUsage);
  });

  test("keeps mounted transcript but clears runtime state when presence is missing during repo reloads", async () => {
    let historyLoads = 0;
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
      loadSessionHistory: async () => {
        historyLoads += 1;
        return [];
      },
    });

    await harness.loadAgentSessions("task-1");

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to stay mounted.`);
    }
    expect(session.status).toBe("idle");
    expect(session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Already visible",
    ]);
    expect(harness.listenedSessions).toEqual([]);
    expect(historyLoads).toBe(0);
  });

  test("keeps repo session loading successful when one live history snapshot fails", async () => {
    const secondRecord: AgentSessionRecord = {
      ...record,
      externalSessionId: "external-2",
      startedAt: "2026-06-12T08:01:00.000Z",
    };
    const harness = createLoaderHarness({
      listSessionPresence: async () =>
        [record, secondRecord].map((sessionRecord) =>
          toAgentSessionPresenceSnapshotFromLiveSnapshot({
            ref: {
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: sessionRecord.workingDirectory,
              externalSessionId: sessionRecord.externalSessionId,
            },
            snapshot: {
              externalSessionId: sessionRecord.externalSessionId,
              title: `Builder ${sessionRecord.externalSessionId}`,
              startedAt: sessionRecord.startedAt,
              status: { type: "busy" },
              workingDirectory: sessionRecord.workingDirectory,
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
        ),
      loadSessionHistory: async (input) => {
        if (input.externalSessionId === record.externalSessionId) {
          throw new Error("history unavailable");
        }
        return [
          {
            messageId: "history-2",
            role: "assistant",
            timestamp: "2026-06-12T08:01:01.000Z",
            text: "Second transcript",
            parts: [],
          },
        ];
      },
      sessionRecordsByTaskId: { [taskFixture.id]: [record, secondRecord] },
    });

    await expect(harness.loadAgentSessions("task-1")).resolves.toBeUndefined();

    expect(harness.getSession(record.externalSessionId)?.status).toBe("running");
    expect(harness.getSession(record.externalSessionId)?.historyLoadState).toBe("failed");
    const secondSession = harness.getSession(secondRecord.externalSessionId);
    if (!secondSession) {
      throw new Error(`Expected ${secondRecord.externalSessionId} to be loaded.`);
    }
    expect(secondSession.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(secondSession).map((message) => message.content)).toEqual([
      "Second transcript",
    ]);
  });
});
