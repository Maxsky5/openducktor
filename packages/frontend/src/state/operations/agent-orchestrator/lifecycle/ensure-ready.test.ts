import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import { toAgentSessionPresenceSnapshotFromLiveSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createAgentSessionPresenceSnapshotFixture, createDeferred } from "../test-utils";
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
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  selectedModel: null,
  ...overrides,
  historyLoadState: overrides.historyLoadState ?? "not_requested",
});

const createAdapter = () => {
  const adapter = new OpencodeSdkAdapter();
  adapter.listSessionPresence = async () => [];
  adapter.readSessionPresence = async (input) =>
    toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: input,
      snapshot: null,
    });
  return adapter;
};
describe("agent-orchestrator-ensure-ready", () => {
  test("throws when the local session is missing", async () => {
    const adapter = createAdapter();

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
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow("Session not found: session-1");
    } finally {
    }
  });

  test("restarts listener and skips resume for healthy runtime session", async () => {
    let listenCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    const readSnapshotCalls: Parameters<OpencodeSdkAdapter["readSessionPresence"]>[0][] = [];

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listSessionPresence;
    const originalReadLiveAgentSessionSnapshot = adapter.readSessionPresence;
    adapter.listSessionPresence = async () => {
      throw new Error("ensure-ready must use the single-session snapshot read");
    };
    adapter.readSessionPresence = async (input) => {
      readSnapshotCalls.push(input);
      return createAgentSessionPresenceSnapshotFixture({ ref: input });
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({ status: "idle" }),
      },
    };
    const unsubscribersRef = { current: new Map<string, () => void>() };

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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
        unsubscribersRef.current.set("session-1", () => {});
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");
      expect(listenCalls).toBe(1);
      expect(unsubscribersRef.current.has("session-1")).toBe(true);
      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
      expect(readSnapshotCalls).toEqual([
        {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
        },
      ]);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionPresence = originalListLiveAgentSessionSnapshots;
      adapter.readSessionPresence = originalReadLiveAgentSessionSnapshot;
    }
  });

  test("keeps the local listener while failing on a missing live runtime session", async () => {
    const listenerStarted = true;
    const releaseCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalReadLiveAgentSessionSnapshot = adapter.readSessionPresence;
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.readSessionPresence = async () =>
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
        },
        snapshot: null,
      });

    const sessionsRef = {
      current: {
        "external-1": buildSession({ status: "idle" }),
      },
    };
    const unsubscribersRef = {
      current: new Map<string, () => void>([
        [
          "external-1",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["external-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["external-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("external-1")).rejects.toThrow(
        "Runtime did not report resumed session 'external-1'.",
      );
      expect(releaseCalls).toBe(0);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(listenerStarted).toBe(true);
      expect(unsubscribeCalls).toBe(0);
      expect(unsubscribersRef.current.has("external-1")).toBe(true);
      expect(sessionsRef.current["external-1"]?.runtimeKind).toBe("opencode");
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionPresence = originalReadLiveAgentSessionSnapshot;
    }
  });

  test("leaves local state intact when stale runtime session stop fails", async () => {
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;
    let updateCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalReadLiveAgentSessionSnapshot = adapter.readSessionPresence;
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
      throw new Error("stop boom");
    };
    adapter.readSessionPresence = async () =>
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
        },
        snapshot: null,
      });

    const sessionsRef = {
      current: {
        "external-1": buildSession({
          status: "idle",
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["*"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
        }),
      },
    };
    const unsubscribersRef = {
      current: new Map<string, () => void>([
        [
          "external-1",
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
      updateSession: (_externalSessionId, updater) => {
        updateCalls += 1;
        const current = sessionsRef.current["external-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["external-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady("external-1")).rejects.toThrow("stop boom");
        expect(calls).toHaveLength(0);
      });
      expect(updateCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(unsubscribersRef.current.has("external-1")).toBe(true);
      expect(sessionsRef.current["external-1"]?.runtimeKind).toBe("opencode");
      expect(sessionsRef.current["external-1"]?.pendingApprovals).toHaveLength(0);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionPresence = originalReadLiveAgentSessionSnapshot;
    }
  });

  test("keeps runtime session runtime metadata when refreshing a session", async () => {
    let ensureRuntimeCalls = 0;

    const adapter = createAdapter();
    adapter.readSessionPresence = async () =>
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "Builder Session",
        },
      });
    adapter.listSessionPresence = async () => [createAgentSessionPresenceSnapshotFixture()];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          runtimeKind: "opencode",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => {
        ensureRuntimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(ensureRuntimeCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.runtimeKind).toBe("opencode");
    } finally {
    }
  });

  test("keeps explicit session runtime kind when selected model conflicts", async () => {
    let ensureRuntimeCalls = 0;

    const adapter = createAdapter();
    adapter.readSessionPresence = async () =>
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "Builder Session",
        },
      });
    adapter.listSessionPresence = async () => [createAgentSessionPresenceSnapshotFixture()];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          runtimeKind: "opencode",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "high",
            profileId: "Hephaestus (Deep Agent)",
          },
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
      updateSession: () => {},
      listenToAgentSession: () => {},
      ensureRuntime: async () => {
        ensureRuntimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(ensureRuntimeCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.runtimeKind).toBe("opencode");
    } finally {
    }
  });

  test("fails when runtime session runtime metadata is missing instead of falling back", async () => {
    let ensureRuntimeCalls = 0;
    const runtimeSession = buildSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5.4",
        variant: "high",
        profileId: "Hephaestus (Deep Agent)",
      },
      status: "idle",
    });
    delete (runtimeSession as Partial<AgentSessionState>).runtimeKind;

    const adapter = createAdapter();

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
          "session-1": runtimeSession,
        },
      },
      taskRef: { current: [taskFixture] },
      unsubscribersRef: { current: new Map() },
      updateSession: () => {},
      listenToAgentSession: () => {},
      ensureRuntime: async () => {
        ensureRuntimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Session 'external-1' is missing runtime kind metadata.",
      );
      expect(ensureRuntimeCalls).toBe(0);
    } finally {
    }
  });

  test("blocks readiness when runtime presence reports pending input", async () => {
    let listenCalls = 0;
    let resumeCalls = 0;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listSessionPresence;
    adapter.readSessionPresence = async () =>
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          status: { type: "busy" },
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["**/.env"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
        },
      });
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        ref: { repoPath: "/tmp/repo", workingDirectory: "/tmp/repo/worktree" },
        snapshot: {
          externalSessionId: "external-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "busy" },
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["**/.env"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          pendingQuestions: [],
        },
      }),
    ];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "idle",
          pendingApprovals: [],
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Session is waiting for pending runtime input.",
      );
      expect(listenCalls).toBe(1);
      expect(resumeCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.status).toBe("idle");
      expect(sessionsRef.current["session-1"]?.pendingApprovals).toEqual([
        {
          requestId: "perm-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/.env"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ]);
    } finally {
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionPresence = originalListLiveAgentSessionSnapshots;
    }
  });

  test("fails fast when a runtime session with legacy runtime metadata is missing from the live snapshot", async () => {
    let listenCalls = 0;
    let ensureRuntimeCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "idle",
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["*"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
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
    const unsubscribersRef = { current: new Map<string, () => void>() };

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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
        unsubscribersRef.current.set("session-1", () => {});
      },
      ensureRuntime: async () => {
        ensureRuntimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Runtime did not report resumed session 'session-1'.",
      );

      expect(listenCalls).toBe(0);
      expect(unsubscribersRef.current.has("session-1")).toBe(false);
      expect(ensureRuntimeCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingApprovals).toEqual([]);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toEqual([]);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("fails fast when a resumed session is missing from the live snapshot", async () => {
    let listenCalls = 0;
    let unsubscribeCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          status: "error",
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["*"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady("session-1")).rejects.toThrow(
        "Runtime did not report resumed session 'session-1'.",
      );

      expect(unsubscribeCalls).toBe(0);
      expect(stopCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(listenCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.status).toBe("error");
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("clears stale listener handles and restarts listener after successful resume", async () => {
    let listenCalls = 0;
    let unsubscribeCalls = 0;
    let resumeCalls = 0;
    let readPresenceCalls = 0;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.readSessionPresence = async (input) => {
      readPresenceCalls += 1;
      return toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: input,
        snapshot:
          readPresenceCalls === 1
            ? null
            : {
                externalSessionId: "external-1",
                title: "BUILD task-1",
                workingDirectory: "/tmp/repo/worktree",
                startedAt: "2026-02-22T08:00:00.000Z",
                status: { type: "idle" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };

    const sessionsRef = {
      current: {
        "session-1": buildSession({ status: "idle" }),
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
        unsubscribersRef.current.set("session-1", () => {});
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(1);
      expect(listenCalls).toBe(1);
      expect(unsubscribersRef.current.has("session-1")).toBe(true);
    } finally {
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("fails when stopping a runtime error session fails", async () => {
    let resumeCalls = 0;
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady("session-1")).rejects.toThrow("stop boom");
        expect(calls).toHaveLength(0);
      });
      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(unsubscribersRef.current.has("session-1")).toBe(true);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("stops runtime error sessions even when persisted runtime id is missing", async () => {
    let listenCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalReadLiveAgentSessionSnapshot = adapter.readSessionPresence;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.readSessionPresence = async (input) =>
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: input,
        snapshot: {
          externalSessionId: "external-1",
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          startedAt: "2026-02-22T08:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [],
          pendingQuestions: [],
        },
      });

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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {
        listenCalls += 1;
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(1);
      expect(listenCalls).toBe(1);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionPresence = originalReadLiveAgentSessionSnapshot;
    }
  });

  test("stops resumed session when workspace becomes stale after resume", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
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
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("surfaces stale-resume cleanup failures instead of masking them", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady("session-1")).rejects.toThrow("stop boom");
        expect(calls).toHaveLength(0);
      });
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("forwards selected model and profile when resuming a session that is not live", async () => {
    let resumedInput:
      | Parameters<InstanceType<typeof OpencodeSdkAdapter>["resumeSession"]>[0]
      | null = null;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listSessionPresence;
    let readPresenceCalls = 0;
    adapter.readSessionPresence = async (input) => {
      readPresenceCalls += 1;
      return toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: input,
        snapshot:
          readPresenceCalls === 1
            ? null
            : {
                externalSessionId: input.externalSessionId,
                title: "Builder Session",
                workingDirectory: input.workingDirectory,
                startedAt: "2026-02-22T08:00:00.000Z",
                status: { type: "idle" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.listSessionPresence = async () => [createAgentSessionPresenceSnapshotFixture()];

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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");
      expect(resumedInput).toMatchObject({
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
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionPresence = originalListLiveAgentSessionSnapshots;
    }
  });

  test("passes top-level session runtime metadata when resuming a session that is not live", async () => {
    let ensuredRuntimeKind: string | null | undefined = null;
    let resumedInput:
      | Parameters<InstanceType<typeof OpencodeSdkAdapter>["resumeSession"]>[0]
      | null = null;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    const originalListLiveAgentSessionSnapshots = adapter.listSessionPresence;
    let readPresenceCalls = 0;
    adapter.readSessionPresence = async (input) => {
      readPresenceCalls += 1;
      return toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: input,
        snapshot:
          readPresenceCalls === 1
            ? null
            : {
                externalSessionId: input.externalSessionId,
                title: "Builder Session",
                workingDirectory: input.workingDirectory,
                startedAt: "2026-02-22T08:00:00.000Z",
                status: { type: "idle" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    adapter.listSessionPresence = async () => [createAgentSessionPresenceSnapshotFixture()];

    const sessionsRef = {
      current: {
        "session-1": buildSession({
          runtimeKind: "opencode",
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
      updateSession: (_externalSessionId, updater) => {
        const current = sessionsRef.current["session-1"];
        if (!current) {
          return;
        }
        sessionsRef.current["session-1"] = updater(current);
      },
      listenToAgentSession: () => {},
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredRuntimeKind = options?.runtimeKind;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady("session-1");

      expect(String(ensuredRuntimeKind)).toBe("opencode");
      expect(resumedInput).toMatchObject({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      });
      expect(resumedInput).not.toHaveProperty("runtimeConnection");
      expect(sessionsRef.current["session-1"]?.runtimeKind).toBe("opencode");
    } finally {
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionPresence = originalListLiveAgentSessionSnapshots;
    }
  });

  test("does not start a runtime when prompt override loading fails during resume", async () => {
    let runtimeCalls = 0;

    const adapter = createAdapter();

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
      listenToAgentSession: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
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
    }
  });

  test("does not start a runtime when the workspace becomes stale after prompt loading", async () => {
    let runtimeCalls = 0;
    const promptOverridesDeferred = createDeferred<Record<string, string>>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = createAdapter();

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
      listenToAgentSession: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
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
    }
  });
});
