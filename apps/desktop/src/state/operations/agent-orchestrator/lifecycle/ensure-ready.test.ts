import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createEnsureSessionReady } from "./ensure-ready";

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "desc",
  acceptanceCriteria: "ac",
  notes: "",
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
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: "run-1",
  baseUrl: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

describe("agent-orchestrator-ensure-ready", () => {
  test("throws when attached runtime exists but local session is missing", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => true;

    const ensureReady = createEnsureSessionReady({
      activeRepo: "/tmp/repo",
      adapter,
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow("Session not found: session-1");
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("reattaches listener and skips resume for healthy attached session", async () => {
    let attachCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        sessionId: "session-1",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({ status: "idle" }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeRepo: "/tmp/repo",
      adapter,
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: (_sessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      attachSessionListener: () => {
        attachCalls += 1;
      },
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    try {
      await ensureReady("session-1");
      expect(attachCalls).toBe(1);
      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("recovers attached error session and clears pending requests", async () => {
    let attachCalls = 0;
    let unsubscribeCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    let todosCalls = 0;
    let catalogCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        sessionId: "session-1",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "error",
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const unsubscribersRef = {
      current: new Map<string, () => void>([
        [
          "session-1",
          () => {
            unsubscribeCalls += 1;
          },
        ],
      ]),
    };

    const ensureReady = createEnsureSessionReady({
      activeRepo: "/tmp/repo",
      adapter,
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      taskRef: { current: [taskFixture] },
      unsubscribersRef,
      updateSession: (_sessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      attachSessionListener: () => {
        attachCalls += 1;
      },
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      loadSessionTodos: async () => {
        todosCalls += 1;
      },
      loadSessionModelCatalog: async () => {
        catalogCalls += 1;
      },
    });

    try {
      await ensureReady("session-1");

      expect(unsubscribeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(todosCalls).toBe(1);
      expect(catalogCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("idle");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("stops resumed session when workspace becomes stale after resume", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => false;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      previousRepoRef.current = "/tmp/other";
      return {
        sessionId: "session-1",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({ status: "idle" }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeRepo: "/tmp/repo",
      adapter,
      repoEpochRef: { current: 1 },
      previousRepoRef,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: (_sessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Workspace changed while preparing session.",
      );
      expect(stopCalls).toBe(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });
});
