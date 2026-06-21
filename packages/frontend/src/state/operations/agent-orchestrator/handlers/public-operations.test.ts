import { describe, expect, mock, test } from "bun:test";
import { toast } from "sonner";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { createOrchestratorPublicOperations } from "./public-operations";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};

const SESSION_IDENTITY = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktrees/session-1",
};

type SessionActions = Parameters<typeof createOrchestratorPublicOperations>[0]["sessionActions"];
type PublicAgentEngine = Parameters<typeof createOrchestratorPublicOperations>[0]["agentEngine"];

const createSessionActions = (overrides: Partial<SessionActions> = {}): SessionActions => {
  return {
    startAgentSession: async () => ({
      externalSessionId: "session-started",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-started",
    }),
    sendAgentMessage: async () => {},
    stopAgentSession: async () => {},
    updateAgentSessionModel: () => {},
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
    ...overrides,
  };
};

const createAgentEngine = (overrides: Partial<PublicAgentEngine> = {}): PublicAgentEngine => ({
  loadSessionTodos: async () => [],
  loadSessionHistory: async () => [],
  subscribeEvents: async () => () => undefined,
  ...overrides,
});

const createPublicOperations = (
  overrides: Partial<Parameters<typeof createOrchestratorPublicOperations>[0]> = {},
) =>
  createOrchestratorPublicOperations({
    agentEngine: createAgentEngine(),
    sessionActions: createSessionActions(),
    loadAgentSessionHistory: async () => null,
    ...overrides,
  });

describe("agent-orchestrator-public-operations", () => {
  test("rethrows start errors without adding a toast", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createPublicOperations({
      agentEngine: createAgentEngine(),
      sessionActions: createSessionActions({
        startAgentSession: async () => {
          throw new Error("start failed");
        },
      }),
    });

    try {
      await expect(
        operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("start failed");
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      toast.error = originalToastError;
    }
  });

  test("shows toast and rethrows send errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createPublicOperations({
      agentEngine: createAgentEngine(),
      sessionActions: createSessionActions({
        sendAgentMessage: async () => {
          throw new Error("send failed");
        },
      }),
    });

    try {
      await expect(
        operations.sendAgentMessage(SESSION_IDENTITY, [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("send failed");
      expect(toastError).toHaveBeenCalledWith("Failed to send message", {
        description: "send failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("shows toast and rethrows stop errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createPublicOperations({
      agentEngine: createAgentEngine(),
      sessionActions: createSessionActions({
        stopAgentSession: async () => {
          throw new Error("stop failed");
        },
      }),
    });

    try {
      await expect(operations.stopAgentSession(SESSION_IDENTITY)).rejects.toThrow("stop failed");
      expect(toastError).toHaveBeenCalledWith("Failed to stop agent session", {
        description: "stop failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("delegates session reads directly to the agent engine", async () => {
    const loadSessionTodos = mock(async () => []);
    const operations = createPublicOperations({
      agentEngine: createAgentEngine({
        loadSessionTodos,
      }),
      sessionActions: createSessionActions(),
    });
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    await operations.readSessionTodos(sessionRef);

    expect(loadSessionTodos).toHaveBeenCalledWith(sessionRef);
  });

  test("forwards full session history inputs without stripping transient context", async () => {
    const readSessionHistory = mock(async () => []);
    const operations = createPublicOperations({
      agentEngine: createAgentEngine({
        loadSessionHistory: readSessionHistory,
      }),
      sessionActions: createSessionActions(),
    });

    await operations.readSessionHistory({
      repoPath: "/repo-a",
      runtimeKind: "codex",
      workingDirectory: "/repo-a/worktree",
      externalSessionId: "session-1",
      systemPromptContext: {
        systemPrompt: "Use the repository rules.",
        startedAt: "2026-06-14T08:00:00.000Z",
      },
      limit: 50,
    });

    expect(readSessionHistory).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      runtimeKind: "codex",
      workingDirectory: "/repo-a/worktree",
      externalSessionId: "session-1",
      systemPromptContext: {
        systemPrompt: "Use the repository rules.",
        startedAt: "2026-06-14T08:00:00.000Z",
      },
      limit: 50,
    });
  });

  test("delegates session event subscriptions directly to the agent engine", async () => {
    const unsubscribe = mock(() => undefined);
    const subscribeEvents = mock(async () => unsubscribe);
    const operations = createPublicOperations({
      agentEngine: createAgentEngine({
        subscribeEvents,
      }),
      sessionActions: createSessionActions(),
    });
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };
    const listener = mock(() => undefined);

    const result = await operations.subscribeSessionEvents(sessionRef, listener);

    expect(subscribeEvents).toHaveBeenCalledWith(sessionRef, listener);
    expect(result).toBe(unsubscribe);
  });

  test("exposes store-backed session history loading as a command", async () => {
    const loadedSession: AgentSessionState = {
      externalSessionId: SESSION_IDENTITY.externalSessionId,
      taskId: "task-1",
      role: "build",
      status: "idle",
      startedAt: "2026-06-12T08:00:00.000Z",
      runtimeKind: SESSION_IDENTITY.runtimeKind,
      workingDirectory: SESSION_IDENTITY.workingDirectory,
      historyLoadState: "loaded",
      messages: createSessionMessagesState(SESSION_IDENTITY.externalSessionId),
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
    };
    const loadAgentSessionHistory = mock(async () => loadedSession);
    const operations = createPublicOperations({
      loadAgentSessionHistory,
    });

    const result = await operations.loadAgentSessionHistory(SESSION_IDENTITY);

    expect(loadAgentSessionHistory).toHaveBeenCalledWith(SESSION_IDENTITY);
    expect(result).toBe(loadedSession);
  });
});
