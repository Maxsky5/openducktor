import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createDeferred } from "../test-utils";
import { createEnsureSessionReady } from "./ensure-ready";

const withCapturedConsoleError = async (
  run: (calls: unknown[][]) => Promise<void>,
): Promise<void> => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    await run(calls);
  } finally {
    console.error = originalError;
  }
};

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "desc",
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
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createAdapter = () => {
  const adapter = new OpencodeSdkAdapter();
  adapter.listLiveAgentSessionSnapshots = async () => [];
  return adapter;
};

describe("agent-orchestrator-ensure-ready", () => {
  test("throws when attached runtime exists but local session is missing", async () => {
    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => true;

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
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

    const adapter = createAdapter();
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
        runtimeKind: "opencode",
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
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

  test("uses top-level session runtime metadata when refreshing an attached session", async () => {
    let capturedRuntimeKind: string | null | undefined = null;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => true;

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          runtimeKind: "claude-code",
          runtimeRoute: null,
          selectedModel: null,
          status: "idle",
        }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        capturedRuntimeKind = options?.runtimeKind;
        return {
          kind: "claude-code",
          runtimeKind: "claude-code",
          runtimeId: "runtime-claude",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:5555" },
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(String(capturedRuntimeKind)).toBe("claude-code");
      expect(sessionsRef.current["session-1"]?.runtimeKind).toBe("claude-code");
      expect(sessionsRef.current["session-1"]?.runtimeRoute).toEqual({
        type: "local_http",
        endpoint: "http://127.0.0.1:5555",
      });
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("rejects attached session runtime mismatches instead of using repo defaults", async () => {
    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => true;

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef: {
        current: {
          "session-1": buildSession({
            runtimeKind: "claude-code",
            runtimeRoute: null,
            selectedModel: null,
            status: "idle",
          }),
        },
      },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Session 'session-1' runtime kind metadata 'claude-code' does not match ensured runtime kind 'opencode'.",
      );
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("blocks readiness when attached runtime snapshot reports pending input", async () => {
    let attachCalls = 0;
    let resumeCalls = 0;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    adapter.hasSession = () => true;
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };
    adapter.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "BUILD task-1",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "busy" },
        pendingPermissions: [
          {
            requestId: "perm-1",
            permission: "read",
            patterns: ["**/.env"],
          },
        ],
        pendingQuestions: [],
      },
    ];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "idle",
          pendingPermissions: [],
          pendingQuestions: [],
        }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Session is waiting for pending runtime input.",
      );
      expect(attachCalls).toBe(1);
      expect(resumeCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.status).toBe("running");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toEqual([
        { requestId: "perm-1", permission: "read", patterns: ["**/.env"] },
      ]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.resumeSession = originalResumeSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
    }
  });

  test("recovers attached error session and clears pending requests without a live snapshot", async () => {
    let attachCalls = 0;
    let unsubscribeCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;

    const adapter = createAdapter();
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
        runtimeKind: "opencode",
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(unsubscribeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("idle");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toEqual([]);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toEqual([]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("fails when stopping an attached error session fails", async () => {
    let resumeCalls = 0;
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
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
        "session-1": buildSession({ status: "error" }),
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady("session-1")).rejects.toThrow(
          "Failed to stop attached error session 'session-1' before preparing it: stop boom",
        );
        expect(calls).toHaveLength(1);
        expect(String(calls[0]?.[1] ?? "")).toBe("ensure-ready-stop-attached-error-session");
      });
      expect(resumeCalls).toBe(0);
      expect(unsubscribeCalls).toBe(0);
      expect(unsubscribersRef.current.has("session-1")).toBe(true);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("stops resumed session when workspace becomes stale after resume", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => false;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef,
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
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

  test("surfaces stale-resume cleanup failures instead of masking them", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => false;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
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
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef,
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady("session-1")).rejects.toThrow(
          "Workspace changed while preparing session. Failed to stop stale resumed session 'session-1': stop boom",
        );
        expect(calls).toHaveLength(1);
        expect(String(calls[0]?.[1] ?? "")).toBe("ensure-ready-stop-session-after-stale-resume");
      });
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("forwards selected model and profile when resuming a detached session", async () => {
    let resumedInput:
      | Parameters<InstanceType<typeof OpencodeSdkAdapter>["resumeSession"]>[0]
      | null = null;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    adapter.hasSession = () => false;
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };
    adapter.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        title: "Builder Session",
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "idle" },
        pendingPermissions: [],
        pendingQuestions: [],
      },
    ];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "idle",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "high",
            profileId: "Hephaestus (Deep Agent)",
          },
        }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");
      expect(resumedInput).toMatchObject({
        sessionId: "session-1",
        externalSessionId: "external-1",
        model: {
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      });
      expect(sessionsRef.current["session-1"]?.title).toBe("Builder Session");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.resumeSession = originalResumeSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
    }
  });

  test("passes top-level session runtime metadata when resuming a detached session", async () => {
    let ensuredRuntimeKind: string | null | undefined = null;
    let resumedInput:
      | Parameters<InstanceType<typeof OpencodeSdkAdapter>["resumeSession"]>[0]
      | null = null;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.hasSession = () => false;
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return {
        runtimeKind: "claude-code",
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
          runtimeKind: "claude-code",
          runtimeRoute: null,
          selectedModel: null,
          status: "idle",
        }),
      },
    };

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
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
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredRuntimeKind = options?.runtimeKind;
        return {
          kind: "claude-code",
          runtimeKind: "claude-code",
          runtimeId: "runtime-claude",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:5555" },
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(String(ensuredRuntimeKind)).toBe("claude-code");
      expect(resumedInput).toMatchObject({
        runtimeKind: "claude-code",
        runtimeConnection: { type: "local_http", endpoint: "http://127.0.0.1:5555" },
      });
      expect(sessionsRef.current["session-1"]?.runtimeKind).toBe("claude-code");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("does not start a runtime when prompt override loading fails during resume", async () => {
    let runtimeCalls = 0;

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => false;

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef: {
        current: {
          "session-1": buildSession(),
        },
      },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          runtimeId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => {
        throw new Error("prompt override load failed");
      },
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow("prompt override load failed");
      expect(runtimeCalls).toBe(0);
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("does not start a runtime when the workspace becomes stale after prompt loading", async () => {
    let runtimeCalls = 0;
    const promptOverridesDeferred = createDeferred<Record<string, string>>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = createAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => false;

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      sessionsRef: {
        current: {
          "session-1": buildSession(),
        },
      },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          runtimeId: null,
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => promptOverridesDeferred.promise,
    });

    try {
      const ensurePromise = ensureReady("session-1");
      repoEpochRef.current = 2;
      currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
      promptOverridesDeferred.resolve({});

      await expect(ensurePromise).rejects.toThrow("Workspace changed while preparing session.");
      expect(runtimeCalls).toBe(0);
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });
});
