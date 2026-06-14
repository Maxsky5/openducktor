import { describe, expect, mock, test } from "bun:test";
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
  loadSessionHistorySnapshot,
  shouldLoadSelectedSessionHistory,
} from "./session-history-loader";

const sessionTarget = {
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
} satisfies Parameters<typeof loadSessionHistorySnapshot>[0]["session"];

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

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession,
      session: sessionTarget,
      isStaleRepoOperation: () => true,
    });

    expect(result).toEqual({
      externalSessionId: sessionTarget.externalSessionId,
      status: "stale",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  test("marks the session failed when history loading fails for the current repo operation", async () => {
    const harness = createHistoryLoadHarness();

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("history unavailable");
        },
      },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("failed");
    expect(harness.session.historyLoadState).toBe("failed");
  });

  test("skips duplicate history loads when the current session is already loading", async () => {
    const loadSessionHistory = mock(async () => []);
    const harness = createHistoryLoadHarness({
      ...createSession(),
      historyLoadState: "loading",
    });

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      session: sessionTarget,
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

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      session: sessionTarget,
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

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      sessionsRef: harness.sessionsRef,
      updateSession: harness.updateSession,
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("applied");
    expect(harness.session.historyLoadState).toBe("loaded");
    expect(harness.session.pendingQuestions).toBe(pendingQuestions);
  });

  test("passes transient prompt context to the history adapter without rendering it locally", async () => {
    const harness = createHistoryLoadHarness();
    let historyInput:
      | Parameters<
          Parameters<typeof loadSessionHistorySnapshot>[0]["adapter"]["loadSessionHistory"]
        >[0]
      | null = null;

    const result = await loadSessionHistorySnapshot({
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
      session: {
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

    await loadSessionHistorySnapshot({
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
      session: {
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
