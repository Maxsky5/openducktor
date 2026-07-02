import { describe, expect, mock, test } from "bun:test";
import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage, AgentSessionRuntimeRef } from "@openducktor/core";
import {
  createAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type {
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createSessionMessagesState } from "../support/messages";
import {
  createLoadAgentSessionHistory,
  loadSelectedSessionBaselineHistoryIntoStore,
  loadSessionHistoryIntoStore,
} from "./session-history-loader";

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

const sessionTarget = {
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
} satisfies AgentSessionIdentity;

const createSession = (): AgentSessionState =>
  createAgentSessionFixture({
    externalSessionId: sessionTarget.externalSessionId,
    taskId: "task-1",
    runtimeKind: "opencode",
    role: "build",
    status: "running",
    startedAt: "2026-06-12T08:00:00.000Z",
    workingDirectory: sessionTarget.workingDirectory,
    historyLoadState: "not_requested",
  });

const createHistoryLoadHarness = (initialSession: AgentSessionState = createSession()) => {
  let sessionCollection = createAgentSessionCollection([initialSession]);
  const updateSession: UpdateSession = (identity, updater) => {
    const current = getAgentSession(sessionCollection, identity);
    if (!current) {
      return null;
    }
    const nextSession = updater(current);
    sessionCollection = replaceAgentSession(sessionCollection, nextSession);
    return nextSession;
  };

  return {
    readSessionSnapshot: (identity: AgentSessionIdentity) =>
      getAgentSession(sessionCollection, identity),
    updateSession,
    get session() {
      const session = getAgentSession(sessionCollection, initialSession);
      if (!session) {
        throw new Error(`Expected session '${initialSession.externalSessionId}' to exist.`);
      }
      return session;
    },
  };
};

describe("session history loader", () => {
  test("treats a stale operation as neither applied nor failed", async () => {
    const loadSessionHistory = mock(async () => []);
    const harness = createHistoryLoadHarness();
    const updateSession = mock(harness.updateSession);

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => true,
    });

    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(harness.session.historyLoadState).toBe("not_requested");
  });

  test("releases a loading history claim when the operation becomes stale", async () => {
    const harness = createHistoryLoadHarness();
    let stale = false;

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          stale = true;
          return [];
        },
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => stale,
    });

    expect(harness.session.historyLoadState).toBe("not_requested");
  });

  test("marks the session failed when history loading fails for the current repo operation", async () => {
    const harness = createHistoryLoadHarness();

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("history unavailable");
        },
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("failed");
  });

  test("allows caller-requested history loads to retry failed sessions", async () => {
    const loadSessionHistory = mock(async () => [
      {
        messageId: "history-1",
        role: "assistant" as const,
        timestamp: "2026-06-12T08:00:01.000Z",
        text: "Loaded after retry",
        parts: [],
      },
    ]);
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "failed",
    });

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(loadSessionHistory).toHaveBeenCalledTimes(1);
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Loaded after retry",
    ]);
  });

  test("loads selected session history directly from the current session identity", async () => {
    const harness = createHistoryLoadHarness();
    let receivedSystemPrompt: string | undefined;
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/repo",
      workspaceId: "workspace-1",
      adapter: {
        loadSessionHistory: async (input) => {
          receivedSystemPrompt = input.systemPromptContext?.systemPrompt;
          return [
            {
              messageId: "history-1",
              role: "assistant",
              timestamp: "2026-06-12T08:00:01.000Z",
              text: "Loaded selected transcript",
              parts: [],
            },
          ];
        },
      },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      taskRef: { current: [taskFixture] },
      loadRepoPromptOverrides: async (): Promise<RepoPromptOverrides> => ({}),
    });

    await loadAgentSessionHistory(sessionTarget);

    expect(receivedSystemPrompt).toContain("Task context");
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Loaded selected transcript",
    ]);
  });

  test("loads history without workflow role context", async () => {
    const sessionWithoutRole = {
      ...createSession(),
      role: null,
    };
    const harness = createHistoryLoadHarness(sessionWithoutRole);
    const loadRepoPromptOverrides = mock(async (): Promise<RepoPromptOverrides> => ({}));
    const loadSessionHistory = mock(async () => [
      {
        messageId: "history-1",
        role: "assistant" as const,
        timestamp: "2026-06-12T08:00:01.000Z",
        text: "History can load without workflow role context.",
        parts: [],
      },
    ]);
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/repo",
      workspaceId: "workspace-1",
      adapter: { loadSessionHistory },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      taskRef: { current: [] },
      loadRepoPromptOverrides,
    });

    await loadAgentSessionHistory(sessionTarget);

    expect(loadRepoPromptOverrides).not.toHaveBeenCalled();
    expect(loadSessionHistory).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      externalSessionId: "external-1",
      runtimePolicy: { kind: "opencode" },
      limit: 600,
    });
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "History can load without workflow role context.",
    ]);
  });

  test("fails selected history loading for an unknown session", async () => {
    const harness = createHistoryLoadHarness();
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      workspaceRepoPath: "/repo",
      workspaceId: "workspace-1",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("History must not load for an unknown session.");
        },
      },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      taskRef: { current: [taskFixture] },
      loadRepoPromptOverrides: async (): Promise<RepoPromptOverrides> => ({}),
    });

    await expect(
      loadAgentSessionHistory({
        externalSessionId: "missing-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    ).rejects.toThrow("Cannot load history for unknown session 'missing-session'.");
  });

  test("does not start a duplicate history load when another caller already marked it loading", async () => {
    const loadSessionHistory = mock(async () => []);
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "loading",
    });

    const loadedSession = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(loadedSession?.historyLoadState).toBe("loading");
    expect(harness.session.historyLoadState).toBe("loading");
  });

  test("does not reset a loaded session when a stale caller asks for history again", async () => {
    const loadSessionHistory = mock(async () => []);
    const loadSystemPromptContext = mock(async () => ({
      systemPrompt: "Should not be prepared.",
      startedAt: "2026-06-12T08:00:00.000Z",
    }));
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "loaded",
    });

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      loadSystemPromptContext,
      isStaleRepoOperation: () => false,
    });

    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(loadSystemPromptContext).not.toHaveBeenCalled();
    expect(harness.session.historyLoadState).toBe("loaded");
  });

  test("loads transcript history without owning live input state", async () => {
    const pendingQuestions: AgentQuestionRequest[] = [
      {
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Keep this pending question visible",
            options: [],
          },
        ],
      },
    ];
    const harness = createHistoryLoadHarness({
      ...createSession(),
      pendingQuestions,
    });

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loaded");
    expect(harness.session.pendingQuestions).toBe(pendingQuestions);
  });

  test("does not erase a live user message when applying a history baseline", async () => {
    const harness = createHistoryLoadHarness({
      ...createSession(),
      messages: createSessionMessagesState(sessionTarget.externalSessionId, [
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
    });

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [
          {
            messageId: "history-1",
            role: "assistant",
            timestamp: "2026-06-12T08:00:00.500Z",
            text: "Previous transcript",
            parts: [],
          },
        ],
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Previous transcript",
      "Resume after QA rejection",
    ]);
  });

  test("merges selected baseline history before live messages that arrive during reload hydration", async () => {
    let resolveHistory!: (history: AgentSessionHistoryMessage[]) => void;
    const historyPromise = new Promise<AgentSessionHistoryMessage[]>((resolve) => {
      resolveHistory = resolve;
    });
    const harness = createHistoryLoadHarness();

    const loadPromise = loadSelectedSessionBaselineHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => historyPromise,
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loading");

    harness.updateSession(sessionTarget, (current) => ({
      ...current,
      messages: createSessionMessagesState(sessionTarget.externalSessionId, [
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
    }));

    resolveHistory([
      {
        messageId: "history-1",
        role: "assistant",
        timestamp: "2026-06-12T08:00:00.500Z",
        text: "Previous transcript",
        parts: [],
      },
    ]);

    const loadedSession = await loadPromise;

    expect(loadedSession?.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Previous transcript",
      "Resume after QA rejection",
    ]);
  });

  test("reconciles a local accepted user send when baseline history confirms it", async () => {
    let resolveHistory!: (history: AgentSessionHistoryMessage[]) => void;
    const historyPromise = new Promise<AgentSessionHistoryMessage[]>((resolve) => {
      resolveHistory = resolve;
    });
    const harness = createHistoryLoadHarness();

    const loadPromise = loadSelectedSessionBaselineHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => historyPromise,
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loading");

    harness.updateSession(sessionTarget, (current) => ({
      ...current,
      messages: createSessionMessagesState(sessionTarget.externalSessionId, [
        {
          id: "accepted-user-message",
          role: "user",
          content: "Hi",
          timestamp: "2026-06-12T08:00:01.123Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [{ kind: "text", text: "Hi" }],
          },
        },
      ]),
    }));

    resolveHistory([
      {
        messageId: "runtime-user-confirmed",
        role: "user",
        timestamp: "2026-06-12T08:00:01.000Z",
        text: "Hi",
        displayParts: [{ kind: "text", text: "Hi" }],
        state: "read",
        parts: [],
      },
    ]);

    const loadedSession = await loadPromise;
    const userMessages = sessionMessagesToArray(harness.session).filter(
      (message) => message.role === "user",
    );

    expect(loadedSession?.historyLoadState).toBe("loaded");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toEqual(
      expect.objectContaining({
        id: "accepted-user-message",
        role: "user",
        content: "Hi",
      }),
    );
  });

  test("does not wait for selected session observation before loading baseline history", async () => {
    const observedSessions: AgentSessionRuntimeRef[] = [];
    const harness = createHistoryLoadHarness();
    const loadSessionHistory = mock(async () => [
      {
        messageId: "history-1",
        role: "assistant" as const,
        timestamp: "2026-06-12T08:00:00.500Z",
        text: "Previous transcript",
        parts: [],
      },
    ]);

    await loadSelectedSessionBaselineHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      observeAgentSession: (session) => {
        observedSessions.push(session);
        return new Promise(() => {});
      },
      isStaleRepoOperation: () => false,
    });

    expect(loadSessionHistory).toHaveBeenCalledTimes(1);
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(observedSessions).toEqual([
      {
        externalSessionId: sessionTarget.externalSessionId,
        repoPath: "/repo",
        runtimeKind: sessionTarget.runtimeKind,
        workingDirectory: sessionTarget.workingDirectory,
        runtimePolicy: { kind: "opencode" },
      },
    ]);
  }, 500);

  test("loads selected baseline history when live messages arrive during the hydration claim", async () => {
    const loadSessionHistory = mock(async () => [
      {
        messageId: "history-1",
        role: "assistant" as const,
        timestamp: "2026-06-12T08:00:00.500Z",
        text: "Previous transcript",
        parts: [],
      },
    ]);
    const harness = createHistoryLoadHarness();
    let injectedLiveMessage = false;
    const updateSession: UpdateSession = (identity, updater) =>
      harness.updateSession(identity, (current) => {
        if (injectedLiveMessage) {
          return updater(current);
        }

        injectedLiveMessage = true;
        return updater({
          ...current,
          messages: createSessionMessagesState(sessionTarget.externalSessionId, [
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
        });
      });

    const loadedSession = await loadSelectedSessionBaselineHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(loadSessionHistory).toHaveBeenCalledTimes(1);
    expect(loadedSession?.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Previous transcript",
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
    const harness = createHistoryLoadHarness({
      ...createSession(),
      contextUsage: liveContextUsage,
    });

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
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
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loaded");
    expect(harness.session.contextUsage).toEqual(liveContextUsage);
  });

  test("applies context stats from loaded idle history", async () => {
    const harness = createHistoryLoadHarness();

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
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
                totalTokens: 123,
                contextWindow: 1_000,
              },
            ],
          },
        ],
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loaded");
    expect(harness.session.contextUsage).toEqual({
      totalTokens: 123,
      contextWindow: 1_000,
    });
  });

  test("passes transient prompt context to the history adapter without rendering it locally", async () => {
    const harness = createHistoryLoadHarness();
    let historyInput:
      | Parameters<
          Parameters<typeof loadSessionHistoryIntoStore>[0]["adapter"]["loadSessionHistory"]
        >[0]
      | null = null;

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async (input) => {
          historyInput = input;
          return [
            {
              messageId: "history-1",
              role: "assistant",
              timestamp: "2026-06-12T08:00:01.000Z",
              text: "Loaded from Codex history",
              parts: [],
            },
          ];
        },
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      loadSystemPromptContext: async () => ({
        systemPrompt: "Build from current task context.",
        startedAt: "2026-06-12T08:00:00.000Z",
      }),
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loaded");
    expect(historyInput).toMatchObject({
      externalSessionId: "external-1",
      systemPromptContext: {
        startedAt: "2026-06-12T08:00:00.000Z",
        systemPrompt: "Build from current task context.",
      },
    });
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Loaded from Codex history",
    ]);
  });

  test("keeps the runtime-owned system prompt when history provides one", async () => {
    const harness = createHistoryLoadHarness();

    await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [
          {
            messageId: "runtime-system-1",
            role: "system",
            timestamp: "2026-06-12T08:00:00.000Z",
            text: "System prompt:\n\nRuntime provided prompt.",
            parts: [],
          },
        ],
      },
      readSessionSnapshot: harness.readSessionSnapshot,
      updateSession: harness.updateSession,
      identity: sessionTarget,
      loadSystemPromptContext: async () => ({
        systemPrompt: "Computed display prompt.",
        startedAt: "2026-06-12T08:00:00.000Z",
      }),
      isStaleRepoOperation: () => false,
    });

    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "System prompt:\n\nRuntime provided prompt.",
    ]);
  });
});
