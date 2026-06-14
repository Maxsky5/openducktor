import { describe, expect, mock, test } from "bun:test";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";
import { loadSessionHistorySnapshot } from "./session-history-loader";

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

describe("session history loader", () => {
  test("treats a stale operation as neither applied nor failed", async () => {
    const loadSessionHistory = mock(async () => []);
    const updateSession = mock(() => undefined);

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: { loadSessionHistory },
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
    let session = createSession();

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => {
          throw new Error("history unavailable");
        },
      },
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("failed");
    expect(session.historyLoadState).toBe("failed");
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
    let session = {
      ...createSession(),
      pendingQuestions,
    };

    const result = await loadSessionHistorySnapshot({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
      session: sessionTarget,
      isStaleRepoOperation: () => false,
    });

    expect(result.status).toBe("applied");
    expect(session.historyLoadState).toBe("loaded");
    expect(session.pendingQuestions).toBe(pendingQuestions);
  });

  test("passes transient prompt context to the history adapter without rendering it locally", async () => {
    let session = createSession();
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
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
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
    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "Loaded from Codex history",
    ]);
  });

  test("keeps the runtime-owned system prompt when history provides one", async () => {
    let session = createSession();

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
      updateSession: (_externalSessionId, updater) => {
        session = updater(session);
      },
      session: {
        ...sessionTarget,
        systemPromptContext: {
          systemPrompt: "Computed display prompt.",
          startedAt: "2026-06-12T08:00:00.000Z",
        },
      },
      isStaleRepoOperation: () => false,
    });

    expect(sessionMessagesToArray(session).map((message) => message.content)).toEqual([
      "System prompt:\n\nRuntime provided prompt.",
    ]);
  });
});
