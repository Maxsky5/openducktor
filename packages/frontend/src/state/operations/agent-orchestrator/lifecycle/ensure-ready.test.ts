import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import { type AgentSessionRuntimeRef, toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import { getAgentSession, replaceAgentSessionByIdentity } from "@/state/agent-session-collection";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  addSessionObserverFixture,
  createAgentSessionCollectionRefFixture,
  createAgentSessionRuntimeSnapshotFixture,
  createDeferred,
  createSessionObserversRefFixture,
  findAgentSessionFixture,
  hasSessionObserverFixture,
} from "../test-utils";
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

type BuildSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "session-1";

  return {
    runtimeKind: "opencode",
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-02-22T08:00:00.000Z",
    workingDirectory: "/tmp/repo/worktree",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
    historyLoadState: sessionOverrides.historyLoadState ?? "not_requested",
  };
};

const resumedSummary = (input: AgentSessionRuntimeRef, externalSessionId = "external-1") => ({
  runtimeKind: input.runtimeKind,
  workingDirectory: input.workingDirectory,
  externalSessionId,
  startedAt: "2026-02-22T08:00:00.000Z",
  role: input.role,
  status: "idle" as const,
});

const createAdapter = () => {
  const adapter = new OpencodeSdkAdapter();
  adapter.listSessionRuntimeSnapshots = async () => [];
  adapter.readSessionRuntimeSnapshot = async (input) =>
    toAgentSessionRuntimeSnapshot({
      ref: input,
      snapshot: null,
    });
  return adapter;
};

const createSessionReader = (
  sessionsRef: ReturnType<typeof createAgentSessionCollectionRefFixture>,
) => {
  return (identity: Parameters<typeof getAgentSession>[1]) =>
    getAgentSession(sessionsRef.current, identity);
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
      readSessionSnapshot: () => null,
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: () => {},
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady(buildSession())).rejects.toThrow("Session not found: session-1");
    } finally {
    }
  });

  test("starts observer and skips resume for healthy runtime session", async () => {
    let listenCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    const readSnapshotCalls: Parameters<OpencodeSdkAdapter["readSessionRuntimeSnapshot"]>[0][] = [];

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalListSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalReadSessionRuntimeSnapshot = adapter.readSessionRuntimeSnapshot;
    adapter.listSessionRuntimeSnapshots = async () => {
      throw new Error("ensure-ready must use the single-session snapshot read");
    };
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readSnapshotCalls.push(input);
      return createAgentSessionRuntimeSnapshotFixture({ ref: input });
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "idle" })]);
    const sessionObserversRef = createSessionObserversRefFixture();

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
        listenCalls += 1;
        addSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        });
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady(buildSession());
      expect(listenCalls).toBe(1);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        }),
      ).toBe(true);
      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
      expect(readSnapshotCalls).toEqual([
        {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "session-1",
        },
      ]);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionRuntimeSnapshots = originalListSessionRuntimeSnapshots;
      adapter.readSessionRuntimeSnapshot = originalReadSessionRuntimeSnapshot;
    }
  });

  test("keeps existing observer and skips resume for healthy runtime session", async () => {
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async (input) =>
      createAgentSessionRuntimeSnapshotFixture({ ref: input });
    adapter.resumeSession = async () => {
      throw new Error("Session resume should not run for a healthy runtime session.");
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "idle" })]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
        throw new Error("Existing observer should be reused.");
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    await ensureReady(buildSession());

    expect(unsubscribeCalls).toBe(0);
    expect(
      hasSessionObserverFixture(sessionObserversRef.current, {
        externalSessionId: "session-1",
      }),
    ).toBe(true);
  });

  test("keeps the local observer while failing on a missing live runtime session", async () => {
    const observerStarted = true;
    const releaseCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    const originalReadSessionRuntimeSnapshot = adapter.readSessionRuntimeSnapshot;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input, "session-1");
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.readSessionRuntimeSnapshot = async () =>
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
        },
        snapshot: null,
      });

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({ externalSessionId: "external-1", status: "idle" }),
    ]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "external-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "external-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady(buildSession({ externalSessionId: "external-1" }))).rejects.toThrow(
        "Runtime did not report resumed session 'external-1'.",
      );
      expect(releaseCalls).toBe(0);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(observerStarted).toBe(true);
      expect(unsubscribeCalls).toBe(0);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "external-1",
        }),
      ).toBe(true);
      expect(findAgentSessionFixture(sessionsRef, "external-1")?.runtimeKind).toBe("opencode");
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionRuntimeSnapshot = originalReadSessionRuntimeSnapshot;
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
    const originalReadSessionRuntimeSnapshot = adapter.readSessionRuntimeSnapshot;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
      throw new Error("stop boom");
    };
    adapter.readSessionRuntimeSnapshot = async () =>
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
        },
        snapshot: null,
      });

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
        externalSessionId: "external-1",
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
    ]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "external-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        updateCalls += 1;
        const current = findAgentSessionFixture(sessionsRef, "external-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(
          ensureReady(buildSession({ externalSessionId: "external-1" })),
        ).rejects.toThrow("stop boom");
        expect(calls).toHaveLength(0);
      });
      expect(updateCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "external-1",
        }),
      ).toBe(true);
      expect(findAgentSessionFixture(sessionsRef, "external-1")?.runtimeKind).toBe("opencode");
      expect(findAgentSessionFixture(sessionsRef, "external-1")?.pendingApprovals).toHaveLength(0);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionRuntimeSnapshot = originalReadSessionRuntimeSnapshot;
    }
  });

  test("keeps runtime session runtime metadata when refreshing a session", async () => {
    let ensureRuntimeCalls = 0;

    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async () =>
      createAgentSessionRuntimeSnapshotFixture({
        snapshot: {
          title: "Builder Session",
        },
      });
    adapter.listSessionRuntimeSnapshots = async () => [createAgentSessionRuntimeSnapshotFixture()];

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
        runtimeKind: "opencode",
        selectedModel: null,
        status: "idle",
      }),
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
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
      await ensureReady(buildSession());

      expect(ensureRuntimeCalls).toBe(0);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.runtimeKind).toBe("opencode");
    } finally {
    }
  });

  test("keeps explicit session runtime kind when selected model conflicts", async () => {
    let ensureRuntimeCalls = 0;

    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async () =>
      createAgentSessionRuntimeSnapshotFixture({
        snapshot: {
          title: "Builder Session",
        },
      });
    adapter.listSessionRuntimeSnapshots = async () => [createAgentSessionRuntimeSnapshotFixture()];

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
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
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: () => {},
      observeAgentSession: async () => {},
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
      await ensureReady(buildSession());

      expect(ensureRuntimeCalls).toBe(0);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.runtimeKind).toBe("opencode");
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
    const sessionsRef = createAgentSessionCollectionRefFixture([runtimeSession]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: () => {},
      observeAgentSession: async () => {},
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
      await expect(ensureReady(buildSession())).rejects.toThrow("Session not found: session-1");
      expect(ensureRuntimeCalls).toBe(0);
    } finally {
    }
  });

  test("blocks readiness when runtime snapshot reports pending input", async () => {
    let listenCalls = 0;
    let resumeCalls = 0;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    const originalListSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    adapter.readSessionRuntimeSnapshot = async () =>
      createAgentSessionRuntimeSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          runtimeActivity: "running",
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
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input, "session-1");
    };
    adapter.listSessionRuntimeSnapshots = async () => [
      createAgentSessionRuntimeSnapshotFixture({
        ref: { repoPath: "/tmp/repo", workingDirectory: "/tmp/repo/worktree" },
        snapshot: {
          title: "BUILD task-1",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeActivity: "running",
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

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
        status: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
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
      await expect(ensureReady(buildSession())).rejects.toThrow(
        "Session is waiting for pending runtime input.",
      );
      expect(listenCalls).toBe(1);
      expect(resumeCalls).toBe(0);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.status).toBe("idle");
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.pendingApprovals).toEqual([
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
      adapter.listSessionRuntimeSnapshots = originalListSessionRuntimeSnapshots;
    }
  });

  test("fails fast when a runtime session with legacy runtime metadata is missing from the runtime snapshot source", async () => {
    let listenCalls = 0;
    let ensureRuntimeCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;

    const adapter = createAdapter();
    const originalStopSession = adapter.stopSession;
    const originalResumeSession = adapter.resumeSession;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
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
    ]);
    const sessionObserversRef = createSessionObserversRefFixture();

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
        listenCalls += 1;
        addSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        });
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
      await expect(ensureReady(buildSession())).rejects.toThrow(
        "Runtime did not report resumed session 'session-1'.",
      );

      expect(listenCalls).toBe(0);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        }),
      ).toBe(false);
      expect(ensureRuntimeCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(stopCalls).toBe(1);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.pendingApprovals).toEqual([]);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.pendingQuestions).toEqual([]);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("fails fast when a resumed session is missing from the runtime snapshot source", async () => {
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
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
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
    ]);

    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
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
      await expect(ensureReady(buildSession())).rejects.toThrow(
        "Runtime did not report resumed session 'session-1'.",
      );

      expect(unsubscribeCalls).toBe(0);
      expect(stopCalls).toBe(1);
      expect(resumeCalls).toBe(1);
      expect(listenCalls).toBe(0);
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.status).toBe("error");
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
    }
  });

  test("keeps exact observer handles after successful resume", async () => {
    let listenCalls = 0;
    let unsubscribeCalls = 0;
    let resumeCalls = 0;
    let readRuntimeSnapshotCalls = 0;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot:
          readRuntimeSnapshotCalls === 1
            ? null
            : {
                title: "BUILD task-1",
                startedAt: "2026-02-22T08:00:00.000Z",
                runtimeActivity: "idle",
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "idle" })]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
        listenCalls += 1;
        addSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        });
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await ensureReady(buildSession());

      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(listenCalls).toBe(0);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        }),
      ).toBe(true);
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
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "error" })]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady(buildSession())).rejects.toThrow("stop boom");
        expect(calls).toHaveLength(0);
      });
      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(
        hasSessionObserverFixture(sessionObserversRef.current, {
          externalSessionId: "session-1",
        }),
      ).toBe(true);
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
    const originalReadSessionRuntimeSnapshot = adapter.readSessionRuntimeSnapshot;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.readSessionRuntimeSnapshot = async (input) =>
      toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot: {
          title: "BUILD task-1",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      });

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "error" })]);
    const sessionObserversRef = createSessionObserversRefFixture([
      {
        externalSessionId: "session-1",
        unsubscribe: () => {
          unsubscribeCalls += 1;
        },
      },
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef,
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {
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
      await ensureReady(buildSession());

      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(1);
      expect(unsubscribeCalls).toBe(0);
      expect(listenCalls).toBe(0);
    } finally {
      adapter.stopSession = originalStopSession;
      adapter.resumeSession = originalResumeSession;
      adapter.readSessionRuntimeSnapshot = originalReadSessionRuntimeSnapshot;
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
    adapter.resumeSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return resumedSummary(input);
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "idle" })]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef,
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await expect(ensureReady(buildSession())).rejects.toThrow(
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
    adapter.resumeSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return resumedSummary(input);
    };

    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession({ status: "idle" })]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef,
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => ({}),
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(ensureReady(buildSession())).rejects.toThrow("stop boom");
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
    const originalListSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    let readRuntimeSnapshotCalls = 0;
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot:
          readRuntimeSnapshotCalls === 1
            ? null
            : {
                title: "Builder Session",
                startedAt: "2026-02-22T08:00:00.000Z",
                runtimeActivity: "idle",
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return resumedSummary(input);
    };
    adapter.listSessionRuntimeSnapshots = async () => [createAgentSessionRuntimeSnapshotFixture()];

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ]);
    const promptOverrides = {
      "system.role.build.base": {
        template: "Build override for {{task.title}}",
        baseVersion: 1,
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
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadRepoPromptOverrides: async () => promptOverrides,
    });

    try {
      await ensureReady(buildSession());
      expect(resumedInput).toMatchObject({
        externalSessionId: "session-1",
        model: {
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      });
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.title).toBe("Builder Session");
      expect(resumedInput).toMatchObject({
        systemPrompt: expect.stringContaining("Build override for Implement feature"),
      });
    } finally {
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionRuntimeSnapshots = originalListSessionRuntimeSnapshots;
    }
  });

  test("passes top-level session runtime metadata when resuming a session that is not live", async () => {
    let ensuredRuntimeKind: string | null | undefined = null;
    let resumedInput:
      | Parameters<InstanceType<typeof OpencodeSdkAdapter>["resumeSession"]>[0]
      | null = null;

    const adapter = createAdapter();
    const originalResumeSession = adapter.resumeSession;
    const originalListSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    let readRuntimeSnapshotCalls = 0;
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot:
          readRuntimeSnapshotCalls === 1
            ? null
            : {
                title: "Builder Session",
                startedAt: "2026-02-22T08:00:00.000Z",
                runtimeActivity: "idle",
                pendingApprovals: [],
                pendingQuestions: [],
              },
      });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return resumedSummary(input);
    };
    adapter.listSessionRuntimeSnapshots = async () => [createAgentSessionRuntimeSnapshotFixture()];

    const sessionsRef = createAgentSessionCollectionRefFixture([
      buildSession({
        runtimeKind: "opencode",
        selectedModel: null,
        status: "idle",
      }),
    ]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: (identity, updater) => {
        const current = findAgentSessionFixture(sessionsRef, "session-1");
        if (!current) {
          return;
        }
        sessionsRef.current = replaceAgentSessionByIdentity(
          sessionsRef.current,
          identity,
          updater(current),
        );
      },
      observeAgentSession: async () => {},
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
      await ensureReady(buildSession());

      expect(String(ensuredRuntimeKind)).toBe("opencode");
      expect(resumedInput).toMatchObject({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        systemPrompt: expect.stringContaining("Task context"),
      });
      expect(resumedInput).not.toHaveProperty("runtimeConnection");
      expect(findAgentSessionFixture(sessionsRef, "session-1")?.runtimeKind).toBe("opencode");
    } finally {
      adapter.resumeSession = originalResumeSession;
      adapter.listSessionRuntimeSnapshots = originalListSessionRuntimeSnapshots;
    }
  });

  test("does not start a runtime when prompt override loading fails during resume", async () => {
    let runtimeCalls = 0;

    const adapter = createAdapter();
    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession()]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: () => {},
      observeAgentSession: async () => {},
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
      await expect(ensureReady(buildSession())).rejects.toThrow("prompt override load failed");
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
    const sessionsRef = createAgentSessionCollectionRefFixture([buildSession()]);

    const ensureReady = createEnsureSessionReady({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      readSessionSnapshot: createSessionReader(sessionsRef),
      taskRef: { current: [taskFixture] },
      sessionObserversRef: createSessionObserversRefFixture(),
      updateSession: () => {},
      observeAgentSession: async () => {},
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
      const ensurePromise = ensureReady(buildSession());
      repoEpochRef.current = 2;
      currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
      promptOverridesDeferred.resolve({});

      await expect(ensurePromise).rejects.toThrow("Workspace changed while preparing session.");
      expect(runtimeCalls).toBe(0);
    } finally {
    }
  });
});
