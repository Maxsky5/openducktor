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
  taskId: "task-1",
  role: "build" as const,
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktrees/session-1",
};

const codexRuntimePolicy = {
  kind: "codex" as const,
  policy: {
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    commandNetworkAccess: false,
    approvalsReviewerApplies: true,
  },
};

type SessionActions = Parameters<typeof createOrchestratorPublicOperations>[0]["sessionActions"];
type PublicAgentEngine = Parameters<typeof createOrchestratorPublicOperations>[0]["agentEngine"];

const createSessionActions = (overrides: Partial<SessionActions> = {}): SessionActions => {
  return {
    startAgentSession: async () => ({
      externalSessionId: "session-started",
      taskId: "task-1",
      role: "build" as const,
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-started",
    }),
    sendAgentMessage: async () => {},
    stopAgentSession: async () => {},
    updateAgentSessionModel: async () => {},
    replyAgentApproval: async () => {},
    answerAgentQuestion: async () => {},
    ...overrides,
  };
};

const createAgentEngine = (overrides: Partial<PublicAgentEngine> = {}): PublicAgentEngine => ({
  loadSessionTodos: async () => [],
  loadSessionHistory: async () => [],
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
    loadAgentSessionContext: overrides.loadAgentSessionContext ?? (async () => undefined),
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
          role: "build" as const,
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
      runtimePolicy: codexRuntimePolicy,
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
      runtimePolicy: codexRuntimePolicy,
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
      runtimePolicy: codexRuntimePolicy,
      systemPromptContext: {
        systemPrompt: "Use the repository rules.",
        startedAt: "2026-06-14T08:00:00.000Z",
      },
      limit: 50,
    });
  });

  test("exposes store-backed session history loading as a command", async () => {
    const loadedSession: AgentSessionState = {
      externalSessionId: SESSION_IDENTITY.externalSessionId,
      taskId: "task-1",
      role: "build" as const,
      status: "idle",
      runtimeStatusMessage: null,
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
