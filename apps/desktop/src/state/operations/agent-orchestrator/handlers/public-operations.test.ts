import { describe, expect, mock, test } from "bun:test";
import { toast } from "sonner";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createOrchestratorPublicOperations } from "./public-operations";

const createSessionState = (
  sessionId: string,
  startedAt: string,
  taskId = "task-1",
): AgentSessionState => ({
  sessionId,
  externalSessionId: `external-${sessionId}`,
  taskId,
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt,
  runtimeId: "runtime-1",
  runId: "run-1",
  baseUrl: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

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

describe("agent-orchestrator-public-operations", () => {
  test("sorts sessions by startedAt in descending order", () => {
    const operations = createOrchestratorPublicOperations({
      sessionsById: {
        older: createSessionState("older", "2026-03-01T10:00:00.000Z"),
        newer: createSessionState("newer", "2026-03-01T11:00:00.000Z"),
      },
      loadAgentSessions: async () => {},
      sessionActions: createSessionActions(),
    });

    expect(operations.sessions.map((entry) => entry.sessionId)).toEqual(["newer", "older"]);
  });

  test("shows toast and swallows load errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      sessionsById: {},
      loadAgentSessions: async () => {
        throw new Error("load failed");
      },
      sessionActions: createSessionActions(),
    });

    try {
      await expect(operations.loadAgentSessions("task-1")).resolves.toBeUndefined();
      expect(toastError).toHaveBeenCalledWith("Failed to load agent sessions", {
        description: "load failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("shows toast and rethrows start errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      sessionsById: {},
      loadAgentSessions: async () => {},
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
        }),
      ).rejects.toThrow("start failed");
      expect(toastError).toHaveBeenCalledWith("Failed to start agent session", {
        description: "start failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });

  test("shows toast and rethrows send errors", async () => {
    const originalToastError = toast.error;
    const toastError = mock(() => "");
    toast.error = toastError;

    const operations = createOrchestratorPublicOperations({
      sessionsById: {},
      loadAgentSessions: async () => {},
      sessionActions: createSessionActions({
        sendAgentMessage: async () => {
          throw new Error("send failed");
        },
      }),
    });

    try {
      await expect(operations.sendAgentMessage("session-1", "hello")).rejects.toThrow(
        "send failed",
      );
      expect(toastError).toHaveBeenCalledWith("Failed to send message", {
        description: "send failed",
      });
    } finally {
      toast.error = originalToastError;
    }
  });
});
