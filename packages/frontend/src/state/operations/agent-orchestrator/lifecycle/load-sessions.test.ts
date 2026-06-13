import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture, createDeferred } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { createLoadAgentSessions } from "./load-sessions";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const createLoaderHarness = ({
  initialSessionsById = {},
  listSessionPresence,
  loadSessionHistory = async () => [],
}: {
  initialSessionsById?: Record<string, AgentSessionState>;
  listSessionPresence: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["listSessionPresence"];
  loadSessionHistory?: Parameters<
    typeof createLoadAgentSessions
  >[0]["adapter"]["loadSessionHistory"];
}) => {
  let sessionsById: Record<string, AgentSessionState> = initialSessionsById;
  const listenedSessions: AgentSessionRef[] = [];
  const loadAgentSessions = createLoadAgentSessions({
    activeWorkspace: {
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
      repoPath: "/repo",
    },
    adapter: {
      restoreSession: async () => ({
        externalSessionId: record.externalSessionId,
        role: record.role,
        startedAt: record.startedAt,
        status: "idle",
      }),
      listSessionPresence,
      loadSessionHistory,
    },
    repoEpochRef: { current: 0 },
    currentWorkspaceRepoPathRef: { current: "/repo" },
    setSessionsById: (updater) => {
      sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
    },
    updateSession: (externalSessionId, updater) => {
      const current = sessionsById[externalSessionId];
      if (!current) {
        return;
      }
      sessionsById = { ...sessionsById, [externalSessionId]: updater(current) };
    },
    listenToAgentSession: (session) => {
      listenedSessions.push(session);
    },
    queryClient: new QueryClient(),
  });

  return {
    loadAgentSessions,
    listenedSessions,
    getSession: (externalSessionId: string) => sessionsById[externalSessionId] ?? null,
    setSessions: (
      updater: (current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>,
    ) => {
      sessionsById = updater(sessionsById);
    },
  };
};

describe("createLoadAgentSessions", () => {
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

    await harness.loadAgentSessions("task-1", { persistedRecords: [record] });

    expect(harness.getSession("external-1")?.status).toBe("running");
    expect(harness.getSession("external-1")?.runtimeKind).toBe("opencode");
    expect(harness.listenedSessions).toEqual([
      {
        externalSessionId: "external-1",
        repoPath: "/repo",
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
      targetExternalSessionId: "external-1",
      persistedRecords: [record],
    });

    expect(historyLoads).toBe(1);
    expect(harness.getSession("external-1")?.historyLoadState).toBe("loaded");
  });

  test("commits persisted sessions before runtime presence resolves", async () => {
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

    const loading = harness.loadAgentSessions("task-1", { persistedRecords: [record] });

    const session = harness.getSession(record.externalSessionId);
    expect(session?.status).toBe("stopped");
    expect(session?.runtimeKind).toBe("opencode");
    expect(session?.workingDirectory).toBe(record.workingDirectory);
    expect(session?.historyLoadState).toBe("not_requested");

    presenceReady.resolve(undefined);
    await loading;
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

    await harness.loadAgentSessions("task-1", { persistedRecords: [record] });

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
      loadSessionHistory: async () => [],
    });

    const loading = harness.loadAgentSessions("task-1", { persistedRecords: [record] });
    harness.setSessions((current) => ({
      ...current,
      [record.externalSessionId]: {
        ...createAgentSessionFixture({
          externalSessionId: record.externalSessionId,
          taskId: "task-1",
          repoPath: "/repo",
          runtimeKind: "opencode",
          role: "build",
          status: "running",
          startedAt: record.startedAt,
          workingDirectory: record.workingDirectory,
          historyLoadState: "loaded",
        }),
        messages: createSessionMessagesState(record.externalSessionId, [
          {
            id: "history:system-prompt:external-1",
            role: "system",
            content: "System prompt:\n\nBuild the task from the repository rules.",
            timestamp: record.startedAt,
          },
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
      },
    }));
    presenceReady.resolve(undefined);
    await loading;

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to be loaded.`);
    }
    expect(session.status).toBe("running");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "System prompt:\n\nBuild the task from the repository rules.",
      "Resume after QA rejection",
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
        repoPath: "/repo",
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
      initialSessionsById: {
        [record.externalSessionId]: mountedSession,
      },
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

    await harness.loadAgentSessions("task-1", { persistedRecords: [record] });

    expect(harness.getSession("external-1")?.historyLoadState).toBe("loaded");
    expect(harness.getSession("external-1")?.contextUsage).toEqual(liveContextUsage);
  });

  test("keeps a mounted persisted session stable during repo reloads", async () => {
    let historyLoads = 0;
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        repoPath: "/repo",
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
      initialSessionsById: {
        [record.externalSessionId]: mountedSession,
      },
      listSessionPresence: async () => [],
      loadSessionHistory: async () => {
        historyLoads += 1;
        return [];
      },
    });

    await harness.loadAgentSessions("task-1", { persistedRecords: [record] });

    const session = harness.getSession(record.externalSessionId);
    if (!session) {
      throw new Error(`Expected ${record.externalSessionId} to stay mounted.`);
    }
    expect(session.status).toBe("idle");
    expect(session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Already visible",
    ]);
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
    });

    await expect(
      harness.loadAgentSessions("task-1", { persistedRecords: [record, secondRecord] }),
    ).resolves.toBeUndefined();

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
