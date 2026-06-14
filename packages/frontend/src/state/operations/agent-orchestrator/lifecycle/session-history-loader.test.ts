import { describe, expect, mock, test } from "bun:test";
import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
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
import { createSessionMessagesState } from "../support/messages";
import {
  createLoadAgentSessionHistory,
  loadSessionHistoryIntoStore,
  shouldLoadSelectedSessionHistory,
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
} satisfies Parameters<typeof loadSessionHistoryIntoStore>[0]["target"];

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
  const sessionsRef = {
    get current() {
      return sessionCollection;
    },
  };
  return {
    sessionsRef,
    updateSession: (
      identity: AgentSessionIdentity,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = getAgentSession(sessionCollection, identity);
      if (!current) {
        return;
      }
      sessionCollection = replaceAgentSession(sessionCollection, updater(current));
    },
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
  test("owns selected-session history loading policy", () => {
    const partialFailedSession = {
      ...createSession(),
      historyLoadState: "failed" as const,
      messages: createSessionMessagesState(sessionTarget.externalSessionId, [
        {
          id: "existing-message",
          role: "assistant",
          content: "Keep visible while retrying history",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ]),
    };

    expect(
      shouldLoadSelectedSessionHistory({
        repoReadinessState: "ready",
        session: createSession(),
      }),
    ).toBe(true);
    expect(
      shouldLoadSelectedSessionHistory({
        repoReadinessState: "ready",
        session: partialFailedSession,
      }),
    ).toBe(true);
    expect(
      shouldLoadSelectedSessionHistory({
        repoReadinessState: "checking",
        session: createSession(),
      }),
    ).toBe(false);
    expect(
      shouldLoadSelectedSessionHistory({
        repoReadinessState: "ready",
        session: { ...createSession(), historyLoadState: "loading" },
      }),
    ).toBe(false);
  });

  test("treats a stale operation as neither applied nor failed", async () => {
    const loadSessionHistory = mock(async () => []);
    const updateSession = mock(() => undefined);
    const harness = createHistoryLoadHarness();

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => true,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "stale",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  test("releases a loading history claim when the operation becomes stale", async () => {
    const harness = createHistoryLoadHarness();
    let stale = false;

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          stale = true;
          return [];
        },
      },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => stale,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "stale",
    });
    expect(harness.session.historyLoadState).toBe("not_requested");
  });

  test("marks the session failed when history loading fails for the current repo operation", async () => {
    const harness = createHistoryLoadHarness();

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("history unavailable");
        },
      },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("failed");
    expect(harness.session.historyLoadState).toBe("failed");
  });

  test("loads selected session history directly from the current session identity", async () => {
    const harness = createHistoryLoadHarness();
    let receivedSystemPrompt: string | undefined;
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Workspace",
        repoPath: "/repo",
      },
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
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      taskRef: { current: [taskFixture] },
      loadRepoPromptOverrides: async (): Promise<RepoPromptOverrides> => ({}),
    });

    const result = await loadAgentSessionHistory(sessionTarget);

    expect(result).toEqual({ externalSessionId: "external-1", status: "applied" });
    expect(receivedSystemPrompt).toContain("Task context");
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "Loaded selected transcript",
    ]);
  });

  test("fails selected history loading for an unknown session", async () => {
    const harness = createHistoryLoadHarness();
    const loadAgentSessionHistory = createLoadAgentSessionHistory({
      activeWorkspace: {
        workspaceId: "workspace-1",
        workspaceName: "Workspace",
        repoPath: "/repo",
      },
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("History must not load for an unknown session.");
        },
      },
      repoEpochRef: { current: 0 },
      currentWorkspaceRepoPathRef: { current: "/repo" },
      sessionsRef: harness.sessionsRef,
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

  test("skips duplicate history loads when the current session is already loading", async () => {
    const loadSessionHistory = mock(async () => []);
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "loading",
    });

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "skipped",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(harness.session.historyLoadState).toBe("loading");
  });

  test("does not reset a loaded session when a stale caller asks for history again", async () => {
    const loadSessionHistory = mock(async () => []);
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "loaded",
    });

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "skipped",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
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

    const result = await loadSessionHistoryIntoStore({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("applied");
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
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

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
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(harness.session.historyLoadState).toBe("loaded");
    expect(harness.session.contextUsage).toEqual(liveContextUsage);
  });

  test("passes transient prompt context to the history adapter without rendering it locally", async () => {
    const harness = createHistoryLoadHarness();
    let historyInput:
      | Parameters<
          Parameters<typeof loadSessionHistoryIntoStore>[0]["adapter"]["loadSessionHistory"]
        >[0]
      | null = null;

    const result = await loadSessionHistoryIntoStore({
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
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: {
        ...sessionTarget,
        systemPromptContext: {
          systemPrompt: "Build from current task context.",
          startedAt: "2026-06-12T08:00:00.000Z",
        },
      },
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("applied");
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
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      target: {
        ...sessionTarget,
        systemPromptContext: {
          systemPrompt: "Computed display prompt.",
          startedAt: "2026-06-12T08:00:00.000Z",
        },
      },
      isStaleRepoOperation: () => false,
    });

    expect(sessionMessagesToArray(harness.session).map((message) => message.content)).toEqual([
      "System prompt:\n\nRuntime provided prompt.",
    ]);
  });
});
