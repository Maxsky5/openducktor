import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { liveAgentSessionLookupKey, runtimeWorkingDirectoryKey } from "./live-agent-session-cache";
import {
  createHydrationPromptAssemblerStage,
  createRuntimeResolutionPlannerStage,
  hydrateSessionRecordsStage,
  preparePersistedSessionMergeStage,
  type SessionLoadIntent,
} from "./load-sessions-stages";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  promptOverrides: {},
  ...overrides,
});

const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  runtimeKind: "opencode",
  selectedModel: null,
  ...overrides,
});

const createIntent = (overrides: Partial<SessionLoadIntent> = {}): SessionLoadIntent => ({
  repoPath: "/tmp/repo",
  taskId: "task-1",
  mode: "bootstrap",
  requestedSessionId: null,
  requestedHistoryKey: null,
  shouldHydrateRequestedSession: false,
  shouldReconcileLiveSessions: false,
  historyPolicy: "none",
  ...overrides,
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
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    },
    getState: () => state,
  };
};

const createTaskFixture = (): TaskCard => ({
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

describe("load-sessions-stages", () => {
  test("uses the in-memory requested session record without reloading persisted sessions", async () => {
    const existingSession = createSession({ runtimeEndpoint: "http://127.0.0.1:4444" });
    const stateHarness = createStateHarness({ "session-1": existingSession });
    let persistedLoads = 0;
    let setCalls = 0;

    const output = await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "session-1",
        requestedHistoryKey: "/tmp/repo::task-1::session-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: (updater) => {
        setCalls += 1;
        stateHarness.setSessionsById(updater);
      },
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => {
        persistedLoads += 1;
        return [createRecord()];
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    expect(persistedLoads).toBe(0);
    expect(setCalls).toBe(0);
    expect(output.recordsToHydrate).toHaveLength(1);
    expect(output.recordsToHydrate[0]?.sessionId).toBe("session-1");
    expect(output.historyHydrationSessionIds.has("session-1")).toBe(true);
  });

  test("merges persisted records while preserving in-memory pending input", async () => {
    const existingSession = createSession({
      pendingPermissions: [{ requestId: "perm-current", permission: "read", patterns: [".env"] }],
      pendingQuestions: [
        {
          requestId: "question-current",
          questions: [{ header: "Confirm", question: "Ship it?", options: [] }],
        },
      ],
    });
    const stateHarness = createStateHarness({ "session-1": existingSession });

    await preparePersistedSessionMergeStage({
      intent: createIntent(),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [
        createRecord({
          startedAt: "2026-03-01T10:00:00.000Z",
          workingDirectory: "/tmp/repo/updated-worktree",
        }),
      ],
      loadRepoPromptOverrides: async () => ({}),
    });

    const nextSession = stateHarness.getState()["session-1"];
    expect(nextSession?.startedAt).toBe("2026-03-01T10:00:00.000Z");
    expect(nextSession?.pendingPermissions).toEqual(existingSession.pendingPermissions);
    expect(nextSession?.pendingQuestions).toEqual(existingSession.pendingQuestions);
  });

  test("marks requested-history hydration failed when runtime resolution fails", async () => {
    const stateHarness = createStateHarness({ "session-1": createSession() });
    let promptLoads = 0;

    await expect(
      hydrateSessionRecordsStage({
        adapter: {
          hasSession: () => false,
          listLiveAgentSessionSnapshots: async () => [],
          loadSessionHistory: async () => [],
          resumeSession: async (input) => ({
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["session-1"]),
        runtimePlanner: {
          readCurrentHydratedRuntimeResolution: () => null,
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          }),
          loadLiveAgentSessionSnapshot: async () => null,
        },
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
    expect(stateHarness.getState()["session-1"]?.historyHydrationState).toBe("failed");
  });

  test("skips requested-history failure updates when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession({ historyHydrationState: "hydrating" });
    const stateHarness = createStateHarness({ "session-1": initialSession });

    await hydrateSessionRecordsStage({
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [],
        resumeSession: async (input) => ({
          sessionId: input.sessionId,
          externalSessionId: input.externalSessionId,
          role: input.role,
          scenario: input.scenario,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["session-1"]),
      runtimePlanner: {
        readCurrentHydratedRuntimeResolution: () => null,
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          };
        },
        loadLiveAgentSessionSnapshot: async () => null,
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["session-1"]).toEqual(initialSession);
  });

  test("skips runtime projection when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "session-1": initialSession });

    await hydrateSessionRecordsStage({
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [],
        resumeSession: async (input) => ({
          sessionId: input.sessionId,
          externalSessionId: input.externalSessionId,
          role: input.role,
          scenario: input.scenario,
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
        readCurrentHydratedRuntimeResolution: () => null,
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: true,
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            runId: null,
            runtimeEndpoint: "http://127.0.0.1:4444",
            runtimeConnection: {
              endpoint: "http://127.0.0.1:4444",
              workingDirectory: "/tmp/repo/worktree",
            },
          };
        },
        loadLiveAgentSessionSnapshot: async () => null,
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["session-1"]).toEqual(initialSession);
  });

  test("runtime planner reuses current hydrated runtime and preloaded live snapshots", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const stateHarness = createStateHarness({
      "session-1": createSession({
        runtimeKind: "opencode",
        runtimeId: "runtime-current",
        runId: "run-current",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory,
      }),
    });
    const liveSnapshot = {
      externalSessionId: "external-1",
      title: "Builder Session",
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" as const },
      pendingPermissions: [],
      pendingQuestions: [],
      workingDirectory,
    };
    let snapshotLoads = 0;

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "session-1",
        requestedHistoryKey: "/tmp/repo::task-1::session-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedRuntimeConnectionsByKey: new Map([
          [
            runtimeWorkingDirectoryKey("opencode", workingDirectory),
            { endpoint: "http://127.0.0.1:4444", workingDirectory },
          ],
        ]),
        preloadedLiveAgentSessionsByKey: new Map([
          [
            liveAgentSessionLookupKey("opencode", "http://127.0.0.1:4444", workingDirectory),
            [liveSnapshot],
          ],
        ]),
        allowRuntimeEnsure: false,
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        resumeSession: async (input) => ({
          sessionId: input.sessionId,
          externalSessionId: input.externalSessionId,
          role: input.role,
          scenario: input.scenario,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listLiveAgentSessionSnapshots: async () => {
          snapshotLoads += 1;
          return [];
        },
      },
      sessionsRef: stateHarness.sessionsRef,
      recordsToHydrate: [createRecord({ role: "planner", workingDirectory })],
      historyHydrationSessionIds: new Set(["session-1"]),
    });

    const reusedResolution = planner.readCurrentHydratedRuntimeResolution(
      createRecord({ role: "planner", workingDirectory }),
    );

    expect(reusedResolution).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "runtime-current",
      runId: "run-current",
      runtimeEndpoint: "http://127.0.0.1:4444",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:4444",
        workingDirectory,
      },
    });

    const snapshot = await planner.loadLiveAgentSessionSnapshot(
      createRecord({ role: "planner", workingDirectory }),
      {
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-current",
        runId: "run-current",
        runtimeEndpoint: "http://127.0.0.1:4444",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory,
        },
      },
    );

    expect(snapshot).toEqual(liveSnapshot);
    expect(snapshotLoads).toBe(0);
  });

  test("prompt assembler omits system prompt when the task is unavailable", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [] },
    });

    const prelude = await assembler.buildHydrationPreludeMessages({
      record: createRecord({ role: "planner", scenario: "planner_initial" }),
      resolvedScenario: "planner_initial",
      promptOverrides: {},
    });
    const systemPrompt = await assembler.buildHydrationSystemPrompt({
      record: createRecord({ role: "planner", scenario: "planner_initial" }),
      resolvedScenario: "planner_initial",
      promptOverrides: {},
    });

    expect(systemPrompt).toBe("");
    expect(getSessionMessageCount({ sessionId: "session-1", messages: prelude })).toBe(1);
    expect(sessionMessageAt({ sessionId: "session-1", messages: prelude }, 0)).toMatchObject({
      id: "history:session-start:session-1",
      content: "Session started (planner - planner_initial)",
    });
  });

  test("prompt assembler builds system prompt and header messages when the task exists", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [createTaskFixture()] },
    });

    const systemPrompt = await assembler.buildHydrationSystemPrompt({
      record: createRecord({ role: "planner", scenario: "planner_initial" }),
      resolvedScenario: "planner_initial",
      promptOverrides: {},
    });
    const prelude = await assembler.buildHydrationPreludeMessages({
      record: createRecord({ role: "planner", scenario: "planner_initial" }),
      resolvedScenario: "planner_initial",
      promptOverrides: {},
    });

    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(getSessionMessageCount({ sessionId: "session-1", messages: prelude })).toBe(2);
    expect(sessionMessageAt({ sessionId: "session-1", messages: prelude }, 1)).toMatchObject({
      id: "history:system-prompt:session-1",
      content: `System prompt:\n\n${systemPrompt}`,
    });
  });
});
