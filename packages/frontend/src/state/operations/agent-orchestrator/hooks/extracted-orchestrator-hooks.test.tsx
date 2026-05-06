import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { AgentSessionPresenceStore } from "../lifecycle/session-presence-store";
import { useAgentSessionListeners } from "./use-agent-session-listeners";
import { useAgentSessionMutations } from "./use-agent-session-mutations";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";
import { useRepoSessionHydrationEffects } from "./use-repo-session-hydration-effects";
import { useRuntimeTranscriptAttachment } from "./use-runtime-transcript-attachment";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "open",
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
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
};

const sessionRecord: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: null,
};

const taskWithSession: TaskCard = { ...taskFixture, agentSessions: [sessionRecord] };

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeId: "runtime-1",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createNoopEngine = (overrides: Partial<AgentEnginePort> = {}): AgentEnginePort =>
  ({
    hasSession: () => false,
    detachSession: async () => undefined,
    listRuntimeDefinitions: () => [],
    ...overrides,
  }) as AgentEnginePort;

describe("extracted orchestrator hooks", () => {
  test("listener removal clears subscriptions, draft refs, timing refs, and session state", async () => {
    const unsubscribe = mock(() => undefined);
    const Harness = () => {
      const state = useOrchestratorSessionState({
        activeWorkspace: {
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/tmp/repo",
        },
        tasks: [taskFixture],
      });
      const listeners = useAgentSessionListeners({
        agentEngine: createNoopEngine(),
        refBridges: state.refBridges,
        sessionsRef: state.refBridges.sessionsRef,
        commitSessions: state.commitSessions,
        updateSession: () => undefined,
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { state, listeners };
    };
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run(({ state }) => {
      state.commitSessions({ "external-1": createSession() });
      state.refBridges.unsubscribersRef.current.set("external-1", unsubscribe);
      state.refBridges.draftRawBySessionRef.current["external-1"] = { text: "draft" };
      state.refBridges.draftSourceBySessionRef.current["external-1"] = { text: "delta" };
      state.refBridges.draftMessageIdBySessionRef.current["external-1"] = { text: "message-1" };
      state.refBridges.assistantTurnTimingBySessionRef.current["external-1"] = {
        activityStartedAtMs: 1,
      };
      state.refBridges.turnModelBySessionRef.current["external-1"] = null;
    });
    await harness.run(({ listeners }) => listeners.removeSessionIds(["external-1"]));
    const { state } = harness.getLatest();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(state.refBridges.unsubscribersRef.current.has("external-1")).toBe(false);
    expect(state.refBridges.draftRawBySessionRef.current["external-1"]).toBeUndefined();
    expect(state.refBridges.assistantTurnTimingBySessionRef.current["external-1"]).toBeUndefined();
    expect(state.sessionStore.getSessionsByIdSnapshot()["external-1"]).toBeUndefined();
    await harness.unmount();
  });

  test("session mutations persist only changed non-transcript sessions", async () => {
    const store = createAgentSessionsStore();
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-1": createSession() },
    };
    const persisted: AgentSessionRecord[] = [];
    const Harness = () =>
      useAgentSessionMutations({
        workspaceRepoPath: "/tmp/repo",
        sessionsRef,
        commitSessions: (updater) => {
          sessionsRef.current =
            typeof updater === "function" ? updater(sessionsRef.current) : updater;
          store.setSessionsById(sessionsRef.current);
        },
        persistSessionRecord: async (_taskId, record) => {
          persisted.push(record);
        },
      });
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run(({ updateSession }) => {
      updateSession("external-1", (current) => ({ ...current, status: "running" }), {
        persist: true,
      });
    });
    await Promise.resolve();

    expect(sessionsRef.current["external-1"]?.status).toBe("running");
    expect(persisted).toHaveLength(1);

    await harness.run(({ updateSession }) => {
      updateSession("external-1", (current) => ({ ...current, purpose: "transcript" }), {
        persist: false,
      });
      updateSession("external-1", (current) => ({ ...current, status: "idle" }), {
        persist: true,
      });
    });
    await Promise.resolve();

    expect(persisted).toHaveLength(1);
    await harness.unmount();
  });

  test("runtime transcript attachment hydrates history and cleans up failed attaches", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const unsubscribersRef = { current: new Map<string, () => void>() };
    const attachSessionListener = mock(() => undefined);
    const removeSessionIds = mock((ids: string[]) => {
      for (const id of ids) delete sessionsRef.current[id];
    });
    const commitSessions = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (current)
        sessionsRef.current = { ...sessionsRef.current, [externalSessionId]: updater(current) };
    };
    const engine = createNoopEngine({
      hasSession: () => false,
      attachSession: async () => ({
        externalSessionId: "transcript-1",
        role: null,
        status: "idle",
        startedAt: "2026-03-01T10:00:00.000Z",
      }),
      loadSessionHistory: async () => [
        {
          messageId: "message-1",
          role: "assistant",
          text: "hello",
          timestamp: "2026-03-01T10:00:00.000Z",
          parts: [],
        },
      ],
    });
    const Harness = () =>
      useRuntimeTranscriptAttachment({
        agentEngine: engine,
        sessionsRef,
        unsubscribersRef,
        commitSessions,
        updateSession,
        attachSessionListener,
        removeSessionIds,
      });
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run((attachTranscript) =>
      attachTranscript({
        repoPath: "/tmp/repo",
        externalSessionId: "transcript-1",
        runtimeKind: "opencode",
        runtimeId: " runtime-1 ",
        workingDirectory: "/tmp/repo",
      }),
    );

    expect(attachSessionListener).toHaveBeenCalledWith("/tmp/repo", "transcript-1");
    expect(sessionsRef.current["transcript-1"]?.historyHydrationState).toBe("hydrated");

    let failingEngineHasSession = false;
    const failingSessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const failingEngine = createNoopEngine({
      hasSession: () => failingEngineHasSession,
      attachSession: async () => {
        failingEngineHasSession = true;
        throw new Error("attach failed");
      },
      detachSession: mock(async () => undefined),
    });
    const failingHarness = createHookHarness(
      () =>
        useRuntimeTranscriptAttachment({
          agentEngine: failingEngine,
          sessionsRef: failingSessionsRef,
          unsubscribersRef: { current: new Map() },
          commitSessions: (updater) => {
            failingSessionsRef.current =
              typeof updater === "function" ? updater(failingSessionsRef.current) : updater;
          },
          updateSession: (externalSessionId, updater) => {
            const current = failingSessionsRef.current[externalSessionId];
            if (current) {
              failingSessionsRef.current = {
                ...failingSessionsRef.current,
                [externalSessionId]: updater(current),
              };
            }
          },
          attachSessionListener,
          removeSessionIds,
        }),
      undefined,
    );
    await failingHarness.mount();
    await expect(
      failingHarness.run((attachTranscript) =>
        attachTranscript({
          repoPath: "/tmp/repo",
          externalSessionId: "transcript-fail",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo",
        }),
      ),
    ).rejects.toThrow("attach failed");
    expect(removeSessionIds).toHaveBeenCalledWith(["transcript-fail"]);
    await harness.unmount();
    await failingHarness.unmount();
  });

  test("repo hydration effects bootstrap and reconcile pending task sessions", async () => {
    const loadCalls: Array<{ taskId: string; mode: string | undefined }> = [];
    const Harness = ({ repoPath }: { repoPath: string | null }) =>
      useRepoSessionHydrationEffects({
        workspaceRepoPath: repoPath,
        tasks: repoPath ? [taskWithSession] : [],
        sessionsRef: { current: {} },
        currentWorkspaceRepoPathRef: { current: repoPath },
        agentSessionPresenceStore: new AgentSessionPresenceStore(),
        loadAgentSessions: async (taskId, options) => {
          loadCalls.push({ taskId, mode: options?.mode });
        },
        updateSession: () => undefined,
      });
    const harness = createHookHarness<{ repoPath: string | null }, ReturnType<typeof Harness>>(
      Harness,
      { repoPath: "/tmp/repo" },
    );
    await harness.mount();
    await harness.waitFor(() => loadCalls.length >= 2);

    expect(loadCalls).toContainEqual({ taskId: "task-1", mode: undefined });
    expect(loadCalls).toContainEqual({ taskId: "task-1", mode: "reconcile_live" });

    await harness.update({ repoPath: null });
    const countAfterRepoReset = loadCalls.length;
    await Promise.resolve();
    expect(loadCalls).toHaveLength(countAfterRepoReset);
    await harness.unmount();
  });
});
