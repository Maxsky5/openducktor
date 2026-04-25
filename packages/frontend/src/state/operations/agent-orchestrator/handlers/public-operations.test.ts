import { describe, expect, mock, test } from "bun:test";
import { toast } from "sonner";
import { createOrchestratorPublicOperations } from "./public-operations";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};

type SessionActions = Parameters<typeof createOrchestratorPublicOperations>[0]["sessionActions"];

const createSessionActions = (overrides: Partial<SessionActions> = {}): SessionActions => {
  return {
    startAgentSession: async () => "session-started",
    sendAgentMessage: async () => {},
    stopAgentSession: async () => {},
    updateAgentSessionModel: () => {},
    replyAgentPermission: async () => {},
    answerAgentQuestion: async () => {},
    ...overrides,
  };
};

const ensureSessionReadyForView = async (): Promise<boolean> => false;

describe("agent-orchestrator-public-operations", () => {
  test("shows toast and rethrows load errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {
        throw new Error("load failed");
      },
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
      sessionActions: createSessionActions(),
    });

    try {
      await expect(operations.loadAgentSessions("task-1")).rejects.toThrow("load failed");
      expect(toastError).toHaveBeenCalledWith("Failed to load agent sessions", {
        description: "load failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("rethrows start errors without adding a toast", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
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

    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
      sessionActions: createSessionActions({
        sendAgentMessage: async () => {
          throw new Error("send failed");
        },
      }),
    });

    try {
      await expect(
        operations.sendAgentMessage("session-1", [{ kind: "text", text: "hello" }]),
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

    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
      sessionActions: createSessionActions({
        stopAgentSession: async () => {
          throw new Error("stop failed");
        },
      }),
    });

    try {
      await expect(operations.stopAgentSession("session-1")).rejects.toThrow("stop failed");
      expect(toastError).toHaveBeenCalledWith("Failed to stop agent session", {
        description: "stop failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("shows toast and rethrows session view readiness errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView: async () => {
        throw new Error("prepare failed");
      },
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions: async () => {},
      sessionActions: createSessionActions(),
    });

    try {
      await expect(
        operations.ensureSessionReadyForView({
          taskId: "task-1",
          sessionId: "session-1",
          repoReadinessState: "ready",
        }),
      ).rejects.toThrow("prepare failed");
      expect(toastError).toHaveBeenCalledWith("Failed to prepare session", {
        description: "prepare failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("forwards explicit single-session removal without toast wrapping", async () => {
    const removeAgentSession = mock(async () => {});
    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession,
      removeAgentSessions: async () => {},
      sessionActions: createSessionActions(),
    });

    await operations.removeAgentSession("session-1");

    expect(removeAgentSession).toHaveBeenCalledWith("session-1");
  });

  test("forwards explicit session removals without toast wrapping", async () => {
    const removeAgentSessions = mock(async () => {});
    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: async () => {},
      hydrateRequestedTaskSessionHistory: async () => {},
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: async () => {},
      loadAgentSessions: async () => {},
      readSessionModelCatalog: async () => ({
        providers: [],
        models: [],
        variants: [],
        profiles: [],
        defaultModelsByProvider: {},
      }),
      readSessionSlashCommands: async () => ({ commands: [] }),
      readSessionFileSearch: async () => [],
      readSessionTodos: async () => [],
      removeAgentSession: async () => {},
      removeAgentSessions,
      sessionActions: createSessionActions(),
    });

    await operations.removeAgentSessions({ taskId: "task-1", roles: ["build", "qa"] });

    expect(removeAgentSessions).toHaveBeenCalledWith({
      taskId: "task-1",
      roles: ["build", "qa"],
    });
  });
});
