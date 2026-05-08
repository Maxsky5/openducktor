import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type LiveAgentSessionSnapshot,
  type LoadAgentSessionHistoryInput,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createAgentSessionPresenceSnapshotFixture } from "../test-utils";
import {
  type HydrationRuntimePlanner,
  hydrateSessionRecordsStage,
  type SessionLifecycleAdapter,
  type SessionLoadIntent,
  type UpdateSession,
} from "./load-sessions-stages";

type AttachSessionInput = Parameters<AgentEnginePort["attachSession"]>[0];
type ResumeSessionInput = Parameters<AgentEnginePort["resumeSession"]>[0];
type LiveSnapshotOverrides = Omit<Partial<LiveAgentSessionSnapshot>, "title"> & {
  title?: string | undefined;
};

const createSessionSummary = (input: AttachSessionInput | ResumeSessionInput) => ({
  externalSessionId: input.externalSessionId,
  role: input.role,
  startedAt: "2026-03-01T09:00:00.000Z",
  status: "idle" as const,
  runtimeKind: input.runtimeKind,
});

const createLifecycleAdapter = (
  overrides: Partial<SessionLifecycleAdapter> = {},
): SessionLifecycleAdapter => ({
  hasSession: () => false,
  listSessionPresence: async () => [],
  loadSessionHistory: async () => [],
  attachSession: async (input) => createSessionSummary(input),
  resumeSession: async (input) => createSessionSummary(input),
  ...overrides,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  promptOverrides: {},
  ...overrides,
});

const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  runtimeKind: "opencode",
  selectedModel: null,
  ...overrides,
});

const _createIntent = (overrides: Partial<SessionLoadIntent> = {}): SessionLoadIntent => ({
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  taskId: "task-1",
  mode: "bootstrap",
  requestedSessionId: null,
  requestedHistoryKey: null,
  shouldHydrateRequestedSession: false,
  shouldReconcileLiveSessions: false,
  historyPolicy: "none",
  ...overrides,
});

const createSessionPresenceSnapshot = (
  externalSessionId: string,
  workingDirectory: string,
  overrides: LiveSnapshotOverrides = {},
) =>
  createAgentSessionPresenceSnapshotFixture({
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      externalSessionId,
      workingDirectory,
    },
    snapshot: {
      externalSessionId,
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
      workingDirectory,
      ...overrides,
    } as Partial<LiveAgentSessionSnapshot>,
  });

const createStalePresence = (externalSessionId: string, workingDirectory: string) =>
  toAgentSessionPresenceSnapshotFromLiveSnapshot({
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      externalSessionId,
      workingDirectory,
    },
    runtimeId: null,
    snapshot: null,
  });

const createStateHarness = (sessions: Record<string, AgentSessionState>) => {
  let state = sessions;
  const sessionsRef = { current: state };
  return {
    sessionsRef,
    setSessionsById: (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    },
    updateSession: (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    },
    getState: () => state,
  };
};

const _createTaskFixture = (): TaskCard => ({
  id: "task-1",
  title: "Refactor loader",
  description: "Split hydration into explicit stages",
  notes: "",
  status: "ready_for_dev",
  priority: 2,
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
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
});

const createRuntime = (
  workingDirectory: string,
  runtimeKind: RuntimeKind = "opencode",
): RuntimeInstanceSummary => ({
  kind: runtimeKind,
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory,
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-03-01T09:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const _createStdioRuntime = (
  runtimeId: string,
  workingDirectory: string,
): RuntimeInstanceSummary => ({
  ...createRuntime(workingDirectory),
  runtimeId,
  runtimeRoute: { type: "stdio", identity: runtimeId },
});

describe("load-sessions-stages", () => {
  test("marks requested-history hydration failed when runtime resolution fails", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let promptLoads = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: createLifecycleAdapter(),
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        } satisfies HydrationRuntimePlanner,
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => {
          promptLoads += 1;
          return {};
        },
      }),
    ).rejects.toThrow("No live runtime found for working directory /tmp/repo/worktree.");

    expect(promptLoads).toBe(0);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("throws runtime resolution failures for reconcile hydration without marking the task reconciled", async () => {
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });
    let updateCalls = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: createLifecycleAdapter(),
        setSessionsById: stateHarness.setSessionsById,
        updateSession: (externalSessionId: string, updater: Parameters<UpdateSession>[1]) => {
          updateCalls += 1;
          stateHarness.updateSession(externalSessionId, updater);
        },
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(),
        failOnRuntimeResolutionError: true,
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow(
      "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
    );

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
    expect(updateCalls).toBe(0);
  });

  test("keeps starting sessions active when reconcile sees idle runtime presence", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ status: "starting" }),
    });

    await hydrateSessionRecordsStage({
      loadMode: "reconcile_live",
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter(),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            status: { type: "idle" },
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.status).toBe("starting");
  });

  test("keeps pending outbound sends active when reconcile sees idle runtime presence", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ status: "running", pendingUserMessageStartedAt: 123 }),
    });

    await hydrateSessionRecordsStage({
      loadMode: "reconcile_live",
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter(),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            status: { type: "idle" },
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.status).toBe("running");
  });

  test("loads requested-history hydration through the adapter for stdio OpenCode runtimes", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let historyLoads = 0;
    const historyInputs: LoadAgentSessionHistoryInput[] = [];

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listSessionPresence: async () => [],
          loadSessionHistory: async (input: LoadAgentSessionHistoryInput) => {
            historyLoads += 1;
            historyInputs.push(input);
            throw new Error("Adapter rejected stdio runtime connections.");
          },
          attachSession: async (input: AttachSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input: ResumeSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow("Adapter rejected stdio runtime connections.");

    expect(historyLoads).toBe(1);
    expect(historyInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "external-1",
        limit: 600,
      },
    ]);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("skips requested-history failure updates when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession({ historyHydrationState: "hydrating" });
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      livePresenceMode: "apply",
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          };
        },
        readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("skips runtime projection when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          };
        },
        readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("does not let live presence title projection block history hydration", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        title: "Fallback title",
        historyHydrationState: "hydrating",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            title: undefined,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.title).toBe("Fallback title");
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("hydrated");
  });

  test("hydrates parent subagent pending permission overlay from live child snapshots", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ historyHydrationState: "hydrating" }),
    });
    const permissionRequest = {
      requestId: "perm-child-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["src/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const loadedSnapshotSessionIds: string[] = [];

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      livePresenceMode: "apply",
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async (record: AgentSessionRecord) => {
          const externalSessionId = record.externalSessionId;
          loadedSnapshotSessionIds.push(externalSessionId);
          if (externalSessionId === "external-1") {
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          if (externalSessionId === "external-child-session") {
            return createSessionPresenceSnapshot("external-child-session", "/tmp/repo/worktree", {
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingApprovals: [permissionRequest],
              pendingQuestions: [],
            });
          }
          return createStalePresence(externalSessionId, "/tmp/repo/worktree");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(loadedSnapshotSessionIds).toContain("external-child-session");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId?.[
        "external-child-session"
      ],
    ).toEqual([permissionRequest]);
  });

  test("preserves live parent subagent pending overlay entries when child snapshot has no pending permissions", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingApprovalsByExternalSessionId: {
          "external-child-session": [
            {
              requestId: "stale-perm",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["src/**"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          "unscanned-child-session": [
            {
              requestId: "live-perm",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["docs/**"],
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
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async (record: AgentSessionRecord) => {
          const externalSessionId = record.externalSessionId;
          if (externalSessionId === "external-1") {
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          if (externalSessionId === "external-child-session") {
            return createSessionPresenceSnapshot("external-child-session", "/tmp/repo/worktree", {
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          return createStalePresence(externalSessionId, "/tmp/repo/worktree");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId,
    ).toEqual({
      "external-child-session": [
        {
          requestId: "stale-perm",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["src/**"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
      "unscanned-child-session": [
        {
          requestId: "live-perm",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["docs/**"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    });
  });

  test("keeps successful child pending input when another child hydration fails", async () => {
    const stalePermission = {
      requestId: "stale-perm",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["src/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const livePermission = {
      ...stalePermission,
      requestId: "live-perm",
      affectedPaths: ["live/**"],
    };
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingApprovalsByExternalSessionId: {
          "external-child-session": [stalePermission],
        },
      }),
    });
    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listSessionPresence: async () => [],
          loadSessionHistory: async () => [
            {
              messageId: "assistant-parent",
              role: "assistant",
              timestamp: "2026-03-01T09:00:02.000Z",
              text: "",
              parts: [
                {
                  kind: "subagent",
                  messageId: "assistant-parent",
                  partId: "subtask-1",
                  correlationKey: "part:assistant-parent:subtask-1",
                  status: "running",
                  agent: "explorer",
                  description: "Inspect session state",
                  externalSessionId: "external-child-session",
                },
                {
                  kind: "subagent",
                  messageId: "assistant-parent",
                  partId: "subtask-2",
                  correlationKey: "part:assistant-parent:subtask-2",
                  status: "running",
                  agent: "explorer",
                  description: "Inspect second session state",
                  externalSessionId: "external-success-child-session",
                },
              ],
            },
          ],
          attachSession: async (input: AttachSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input: ResumeSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        livePresenceMode: "apply",
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          }),
          readSessionPresence: async (record: AgentSessionRecord) => {
            const externalSessionId = record.externalSessionId;
            if (externalSessionId === "external-child-session") {
              throw new Error("child snapshot unavailable");
            }
            if (externalSessionId === "external-success-child-session") {
              return createSessionPresenceSnapshot(
                "external-success-child-session",
                "/tmp/repo/worktree",
                {
                  title: "Child",
                  startedAt: "2026-03-01T09:00:01.000Z",
                  status: { type: "busy" },
                  pendingApprovals: [livePermission],
                  pendingQuestions: [],
                },
              );
            }
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          },
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow(
      "Failed to hydrate subagent pending input: subagent session 'external-child-session': child snapshot unavailable",
    );

    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId,
    ).toEqual({
      "external-success-child-session": [livePermission],
    });
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingQuestionsByExternalSessionId,
    ).toBeUndefined();
  });
});
