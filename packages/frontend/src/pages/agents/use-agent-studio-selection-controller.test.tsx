import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { buildDisabledRuntimeHealth } from "@/lib/repo-runtime-health";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import {
  type AgentSessionSummary,
  createAgentSessionsStore,
  toAgentSessionSummary,
} from "@/state/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentSessionReadModelLoadState,
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
  unavailableAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type {
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  RepoSettingsInput,
} from "@/types/state-slices";
import {
  createAgentSessionFixture,
  createChecksStateContextValue,
  createRepoRuntimeHealthContextValue,
  createRuntimeDefinitionsContextValue,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  createAgentStudioRouteSelectionState,
  type SelectAgentStudioSelection,
  toAgentStudioSessionlessRoleSelection,
  toAgentStudioSessionSelection,
  toAgentStudioTaskSelection,
} from "./shell/agent-studio-selection-state";
import { useAgentStudioSelectionController } from "./use-agent-studio-selection-controller";

enableReactActEnvironment();

type UseAgentStudioSelectionControllerHook =
  typeof import("./use-agent-studio-selection-controller")["useAgentStudioSelectionController"];

const sessionReadModelLoadStateRef: {
  current: AgentSessionReadModelLoadState;
} = {
  current: unavailableAgentSessionReadModelLoadState,
};
const loadSelectedSessionBaselineHistoryRef: {
  current: AgentSessionHistoryLoadContextValue["loadSelectedSessionBaselineHistory"];
} = {
  current: async () => null,
};
const readSessionTodosRef: {
  current: AgentOperationsContextValue["readSessionTodos"];
} = {
  current: async () => [],
};
const loadAgentSessionContextRef: {
  current: AgentOperationsContextValue["loadAgentSessionContext"];
} = {
  current: async () => undefined,
};
const createdSessionStateByKey = new Map<string, AgentSessionState>();
let sessionStore = createAgentSessionsStore(null);

type HookArgs = Parameters<UseAgentStudioSelectionControllerHook>[0];
type TestContextOverrides = {
  sessionReadModelLoadState?: AgentSessionReadModelLoadState;
  loadSelectedSessionBaselineHistory?: AgentSessionHistoryLoadContextValue["loadSelectedSessionBaselineHistory"];
  readSessionTodos?: AgentOperationsContextValue["readSessionTodos"];
  loadAgentSessionContext?: AgentOperationsContextValue["loadAgentSessionContext"];
  runtimeDefinitionsContext?: Partial<ReturnType<typeof createRuntimeDefinitionsContextValue>>;
  checksStateContext?: Partial<ReturnType<typeof createChecksStateContextValue>>;
  repoRuntimeHealthContext?: Partial<ReturnType<typeof createRepoRuntimeHealthContextValue>>;
};
const emptyCatalog = {
  providers: [],
  models: [],
  variants: [],
  profiles: [],
  defaultModelsByProvider: {},
};

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const activeWorkspaceId = "workspace-1";
const workspaceRepoPath = "/repo";
const repoSettings: RepoSettingsInput = {
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
};

const createSession = (
  taskId: string,
  externalSessionId: string,
  overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {},
): AgentSessionSummary => {
  const session = createAgentSessionFixture({
    externalSessionId,
    taskId,
    ...overrides,
  });
  createdSessionStateByKey.set(agentSessionIdentityKey(session), session);
  return toAgentSessionSummary(session);
};

const sessionExternalIdParam = (session: AgentSessionIdentity): string => session.externalSessionId;

const syncSessionLookup = (sessions: HookArgs["sessions"]): void => {
  sessionStore.setSessionCollection(() =>
    createAgentSessionCollection(
      sessions.flatMap(
        (session) => createdSessionStateByKey.get(agentSessionIdentityKey(session)) ?? [],
      ),
    ),
  );
};

const defaultSessionReadModelLoadState = (
  workspaceRepoPath: string | null,
): AgentSessionReadModelLoadState =>
  workspaceRepoPath
    ? readyAgentSessionReadModelLoadState(workspaceRepoPath)
    : unavailableAgentSessionReadModelLoadState;

const applyTestContextOverrides = (
  hookArgs: HookArgs,
  contextOverrides: TestContextOverrides = {},
): void => {
  sessionReadModelLoadStateRef.current =
    contextOverrides.sessionReadModelLoadState ??
    defaultSessionReadModelLoadState(hookArgs.workspaceRepoPath);
  loadSelectedSessionBaselineHistoryRef.current =
    contextOverrides.loadSelectedSessionBaselineHistory ?? (async () => null);
  readSessionTodosRef.current = contextOverrides.readSessionTodos ?? (async () => []);
  loadAgentSessionContextRef.current =
    contextOverrides.loadAgentSessionContext ?? (async () => undefined);
};

const createHookHarness = (initialProps: HookArgs, contextOverrides: TestContextOverrides = {}) => {
  applyTestContextOverrides(initialProps, contextOverrides);
  syncSessionLookup(initialProps.sessions);
  const runtimeDefinitionsContextRef = {
    current: createRuntimeDefinitionsContextValue(contextOverrides.runtimeDefinitionsContext),
  };
  const checksStateContextRef = {
    current: createChecksStateContextValue(contextOverrides.checksStateContext),
  };
  const repoRuntimeHealthContextRef = {
    current: createRepoRuntimeHealthContextValue(contextOverrides.repoRuntimeHealthContext),
  };
  const agentOperationsValue = (): AgentOperationsContextValue => ({
    readSessionTodos: readSessionTodosRef.current,
    readSessionHistory: async () => [],
    loadAgentSessionHistory: async () => null,
    loadAgentSessionContext: loadAgentSessionContextRef.current,
    startAgentSession: async () => ({
      externalSessionId: "session-started",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    }),
    sendAgentMessage: async () => undefined,
    stopAgentSession: async () => undefined,
    updateAgentSessionModel: async () => undefined,
    replyAgentApproval: async () => undefined,
    answerAgentQuestion: async () => undefined,
  });
  const agentSessionHistoryLoadValue = (): AgentSessionHistoryLoadContextValue => ({
    loadSelectedSessionBaselineHistory: loadSelectedSessionBaselineHistoryRef.current,
  });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <AgentOperationsContext.Provider value={agentOperationsValue()}>
      <AgentSessionHistoryLoadContext.Provider value={agentSessionHistoryLoadValue()}>
        <AgentSessionsContext.Provider value={sessionStore}>
          <AgentSessionReadModelStateContext.Provider
            value={{
              sessionReadModelLoadState: sessionReadModelLoadStateRef.current,
              reloadSessionReadModel: () => undefined,
            }}
          >
            {children}
          </AgentSessionReadModelStateContext.Provider>
        </AgentSessionsContext.Provider>
      </AgentSessionHistoryLoadContext.Provider>
    </AgentOperationsContext.Provider>
  );
  const harness = createSharedHookHarness(useAgentStudioSelectionController, initialProps, {
    wrapper,
    runtimeDefinitionsContextRef,
    checksStateContextRef,
    repoRuntimeHealthContextRef,
  });

  return {
    ...harness,
    update: async (nextProps: HookArgs, nextContextOverrides: TestContextOverrides = {}) => {
      applyTestContextOverrides(nextProps, nextContextOverrides);
      if ("runtimeDefinitionsContext" in nextContextOverrides) {
        runtimeDefinitionsContextRef.current = createRuntimeDefinitionsContextValue(
          nextContextOverrides.runtimeDefinitionsContext,
        );
      }
      if ("checksStateContext" in nextContextOverrides) {
        checksStateContextRef.current = createChecksStateContextValue(
          nextContextOverrides.checksStateContext,
        );
      }
      if ("repoRuntimeHealthContext" in nextContextOverrides) {
        repoRuntimeHealthContextRef.current = createRepoRuntimeHealthContextValue(
          nextContextOverrides.repoRuntimeHealthContext,
        );
      }
      syncSessionLookup(nextProps.sessions);
      await harness.update(nextProps);
    },
  };
};

const noopSelectAgentStudioSelection: SelectAgentStudioSelection = () => {};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => {
  const baseArgs: Omit<HookArgs, "selectionState"> = {
    activeWorkspaceId: null,
    workspaceRepoPath: null,
    isRepoNavigationBoundaryPending: false,
    tasks: [createTask("task-1"), createTask("task-2")],
    isLoadingTasks: false,
    sessions: [],
    taskIdParam: "task-1",
    sessionExternalIdParam: null,
    hasExplicitRoleParam: false,
    roleFromQuery: "spec",
    repoSettings,
    isLoadingRepoSettings: false,
    selectAgentStudioSelection: noopSelectAgentStudioSelection,
    ...overrides,
  };
  return {
    ...baseArgs,
    selectionState:
      overrides.selectionState ??
      createAgentStudioRouteSelectionState({
        isRepoNavigationBoundaryPending: baseArgs.isRepoNavigationBoundaryPending,
        taskIdParam: baseArgs.taskIdParam,
        sessionExternalIdParam: baseArgs.sessionExternalIdParam,
        hasExplicitRoleParam: baseArgs.hasExplicitRoleParam,
        roleFromQuery: baseArgs.roleFromQuery,
      }),
  };
};

describe("useAgentStudioSelectionController", () => {
  beforeEach(() => {
    createdSessionStateByKey.clear();
    sessionStore = createAgentSessionsStore(workspaceRepoPath);
    readSessionTodosRef.current = async () => [];
  });

  afterEach(async () => {
    sessionStore = createAgentSessionsStore(workspaceRepoPath);
  });

  test("does not resolve a session without its task route context", async () => {
    const session = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [session],
        taskIdParam: "",
        sessionExternalIdParam: sessionExternalIdParam(session),
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.routeSessionResolution).toEqual({
        kind: "pending",
        sessionExternalId: "session-2",
      });
      expect(latest.taskId).toBe("");
      expect(latest.selectedTask).toBeNull();
      expect(latest.resolvedRouteSession).toBeNull();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces context recovery failure without hiding pending input", async () => {
    const selectedSession = createSession("task-1", "session-with-approval", {
      contextUsage: null,
      pendingApprovals: [
        {
          requestId: "approval-1",
          requestType: "command_execution",
          title: "Run command",
        },
      ],
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [selectedSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(selectedSession),
      }),
      {
        loadAgentSessionContext: async () => {
          throw new Error("context recovery unavailable");
        },
        runtimeDefinitionsContext: {
          loadRepoRuntimeCatalog: async () => emptyCatalog,
        },
      },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.view.selectedSession.runtimeData.error !== null);

      const latest = harness.getLatest().view.selectedSession;
      expect(latest.runtimeData.error).toBe(
        'Failed to load context usage for session "session-with-approval": context recovery unavailable',
      );
      expect(latest.loadedSession?.pendingApprovals).toEqual([
        expect.objectContaining({ requestId: "approval-1" }),
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("marks selected task session read model loading until a session summary is available", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [createTask("task-1"), createTask("task-2")],
        sessions: [],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
      {
        sessionReadModelLoadState: loadingAgentSessionReadModelLoadState(workspaceRepoPath),
      },
    );

    try {
      await harness.mount();

      expect(harness.getLatest().view.selectedSession.transcriptState).toEqual({
        kind: "session_loading",
        reason: "preparing",
      });
      expect(harness.getLatest().view.selectedSession.loadedSession).toBeNull();

      const loadedSession = createSession("task-1", "session-reloaded", {
        role: "build",
        startedAt: "2026-02-22T10:00:00.000Z",
        status: "running",
      });
      await harness.update(
        createBaseArgs({
          activeWorkspaceId,
          workspaceRepoPath,
          tasks: [createTask("task-1"), createTask("task-2")],
          sessions: [loadedSession],
          taskIdParam: "task-1",
          hasExplicitRoleParam: false,
        }),
      );

      expect(harness.getLatest().view.selectedSession.transcriptState).toEqual({
        kind: "visible",
      });
      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-reloaded",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the selected task resolving while the session read model is loading", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [createTask("task-1")],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: false,
      }),
      {
        sessionReadModelLoadState: loadingAgentSessionReadModelLoadState(workspaceRepoPath),
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "session_loading",
        reason: "preparing",
      });
      expect(latest.view.selectedSession.loadedSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("does not probe runtime readiness while explicit session metadata is pending", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: "session-reloaded",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        sessionReadModelLoadState: loadingAgentSessionReadModelLoadState(workspaceRepoPath),
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture({
              status: "checking",
              runtime: { status: "checking", stage: "waiting_for_runtime" },
            }),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "session_loading",
        reason: "preparing",
      });
      expect(latest.view.selectedSession.loadedSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("scopes selected-session readiness to the selected runtime kind", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const codexSession = createSession("task-1", "codex-session", {
      runtimeKind: "codex",
      role: "build",
      historyLoadState: "not_requested",
      messages: createSessionMessagesState("codex-session"),
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [codexSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(codexSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
          availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        },
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture(),
            codex: createRepoRuntimeHealthFixture({
              status: "checking",
              runtime: { status: "checking", stage: "waiting_for_runtime" },
            }),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession?.runtimeKind).toBe("codex");
      expect(latest.view.selectedSession.runtimeReadiness.state).toBe("checking");
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps selected-session runtime descriptors separate from new-session availability", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const codexSession = createSession("task-1", "codex-session", {
      runtimeKind: "codex",
      role: "build",
      historyLoadState: "not_requested",
      messages: createSessionMessagesState("codex-session"),
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [codexSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(codexSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
          availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        },
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture(),
            codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession?.runtimeKind).toBe("codex");
      expect(latest.view.selectedSession.runtimeReadiness.state).toBe("blocked");
      expect(latest.view.selectedSession.runtimeReadiness.message).toBe(
        "Codex runtime is disabled in Agent Runtime settings.",
      );
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("scopes sessionless readiness to the configured role runtime kind", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        },
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture({
              status: "checking",
              runtime: { status: "checking", stage: "waiting_for_runtime" },
            }),
            codex: createRepoRuntimeHealthFixture(),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.selectedSession.runtimeReadiness.state).toBe("checking");
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps sessionless selection loading while the configured runtime has not started yet", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        },
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture({
              status: "not_started",
              runtime: {
                status: "not_started",
                stage: "idle",
                detail: "Runtime has not been started yet.",
              },
            }),
            codex: createRepoRuntimeHealthFixture(),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.selectedSession.runtimeReadiness).toMatchObject({
        state: "checking",
        message: "OpenCode runtime is starting...",
      });
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not fall back to another ready runtime when the configured runtime is unavailable", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        repoSettings: {
          ...repoSettings,
          defaultRuntimeKind: "codex",
        },
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.selectedSession.runtimeReadiness.state).toBe("blocked");
      expect(latest.view.selectedSession.runtimeReadiness.message).toBe(
        "Runtime 'codex' is not available for agent chat.",
      );
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps sessionless selection waiting while repo runtime settings load", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        repoSettings: null,
        isLoadingRepoSettings: true,
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        runtimeDefinitionsContext: {
          runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        },
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture(),
            codex: createRepoRuntimeHealthFixture(),
          },
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.selectedSession.runtimeReadiness.state).toBe("checking");
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("marks selected task failed when startup read model fails", async () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: "session-reloaded",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
          workspaceRepoPath,
          "Failed to load agent session read model",
        ),
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.routeSessionResolution).toEqual({
        kind: "failed",
        sessionExternalId: "session-reloaded",
        message: "Failed to load agent session read model",
      });
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "failed",
        message: "Failed to load agent session read model",
      });
      expect(latest.view.selectedSession.loadedSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("loads selected session history through the baseline history loader", async () => {
    const loadSessionHistory = mock(async () => null);
    const session = createSession("task-1", "session-live", {
      historyLoadState: "not_requested",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [session],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(session),
      }),
      { loadSelectedSessionBaselineHistory: loadSessionHistory },
    );

    try {
      await harness.mount();

      expect(loadSessionHistory).toHaveBeenCalledWith({
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("loads selected session history after reload without rendering the partial live tail", async () => {
    const loadSessionHistory = mock(async () => null);
    const session = createSession("task-1", "session-live", {
      historyLoadState: "not_requested",
      messages: createSessionMessagesState("session-live", [
        {
          id: "live-message",
          role: "assistant",
          content: "live tail",
          timestamp: "2026-02-22T08:00:03.000Z",
        },
      ]),
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [session],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(session),
      }),
      { loadSelectedSessionBaselineHistory: loadSessionHistory },
    );

    try {
      await harness.mount();

      expect(harness.getLatest().view.selectedSession.transcriptState).toEqual({
        kind: "session_loading",
        reason: "history",
      });
      expect(loadSessionHistory).toHaveBeenCalledWith({
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime readiness before loading selected session history", async () => {
    const loadSessionHistory = mock(async () => null);
    const task = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "in_progress",
    });
    const session = createSession("task-1", "session-live", {
      historyLoadState: "not_requested",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [task],
        sessions: [session],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(session),
      }),
      {
        loadSelectedSessionBaselineHistory: loadSessionHistory,
        repoRuntimeHealthContext: {
          runtimeHealthByRuntime: {
            opencode: createRepoRuntimeHealthFixture({
              runtime: { status: "checking" },
            }),
          },
        },
      },
    );

    try {
      await harness.mount();

      expect(harness.getLatest().view.selectedSession.transcriptState).toEqual({
        kind: "runtime_waiting",
      });
      expect(loadSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("prefers immediate selection state over stale query role and session", async () => {
    const specSession = createSession("task-1", "session-spec", {
      role: "spec",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const plannerSession = createSession("task-1", "session-planner", {
      role: "planner",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [specSession, plannerSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(specSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "spec",
        selectionState: toAgentStudioSessionSelection(plannerSession),
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.view.role).toBe("planner");
      expect(latest.view.launchActionId).toBe("planner_initial");
      expect(latest.view.selectedSession.loadedSession?.externalSessionId).toBe("session-planner");
      expect(latest.routeSessionResolution).toEqual({
        kind: "pending",
        sessionExternalId: "session-spec",
      });
      expect(latest.resolvedRouteSession).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps prepare-session role selection sessionless despite existing role sessions", async () => {
    const buildSession = createSession("task-1", "session-build", {
      role: "build",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [buildSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "spec",
        selectionState: toAgentStudioSessionlessRoleSelection({
          taskId: "task-1",
          role: "build",
        }),
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.resolvedRouteSession?.externalSessionId).toBe("session-build");
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.role).toBe("build");
      expect(latest.view.launchActionId).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });

  test("uses concrete URL session when route selection has a session param", async () => {
    const buildSession = createSession("task-1", "session-build", {
      role: "build",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [buildSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(buildSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.selectedSessionFromRoute?.externalSessionId).toBe("session-build");
      expect(latest.resolvedRouteSession?.externalSessionId).toBe("session-build");
      expect(latest.view.selectedSession.loadedSession?.externalSessionId).toBe("session-build");
      expect(latest.view.role).toBe("build");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps an external route session id pending without starting runtime operations", async () => {
    const staleSessionIdentity: AgentSessionIdentity = {
      externalSessionId: "deleted-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/deleted-session",
    };
    const loadSessionHistory = mock(async () => null);
    const readSessionTodos = mock(async () => []);
    const loadAgentSessionContext = mock(async () => undefined);
    const loadRepoRuntimeCatalog = mock(async () => emptyCatalog);
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [createTask("task-1")],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(staleSessionIdentity),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        sessionReadModelLoadState: loadingAgentSessionReadModelLoadState(workspaceRepoPath),
        loadSelectedSessionBaselineHistory: loadSessionHistory,
        readSessionTodos,
        loadAgentSessionContext,
        runtimeDefinitionsContext: { loadRepoRuntimeCatalog },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.routeSessionResolution).toEqual({
        kind: "pending",
        sessionExternalId: sessionExternalIdParam(staleSessionIdentity),
      });
      expect(latest.view.selectedSession.identity).toBeNull();
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "session_loading",
        reason: "preparing",
      });
      expect(loadSessionHistory).not.toHaveBeenCalled();
      expect(readSessionTodos).not.toHaveBeenCalled();
      expect(loadAgentSessionContext).not.toHaveBeenCalled();
      expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces a missing external route session without default fallback", async () => {
    const staleSessionIdentity: AgentSessionIdentity = {
      externalSessionId: "deleted-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/deleted-session",
    };
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        tasks: [createTask("task-1")],
        sessions: [],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(staleSessionIdentity),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.routeSessionResolution).toEqual({
        kind: "missing",
        sessionExternalId: sessionExternalIdParam(staleSessionIdentity),
      });
      expect(latest.taskId).toBe("task-1");
      expect(latest.selectedTask?.id).toBe("task-1");
      expect(latest.view.selectedSession.identity).toBeNull();
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.selectedSession.transcriptState).toEqual({
        kind: "failed",
        message: 'Agent session "deleted-session" was not found for task "task-1".',
      });
    } finally {
      await harness.unmount();
    }
  });

  test("loads runtime data once when selected and view sessions are the same", async () => {
    const readSessionTodos = mock(async () => [
      {
        id: "todo-1",
        content: "Check startup",
        status: "pending" as const,
        priority: "medium" as const,
      },
    ]);
    const buildSession = createSession("task-1", "session-build", {
      role: "build",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      status: "running",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [buildSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(buildSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      { readSessionTodos },
    );

    try {
      await harness.mount();
      await harness.waitFor((latest) => latest.view.selectedSession.runtimeData.todos.length === 1);

      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledWith(
        expect.objectContaining({
          externalSessionId: "session-build",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        }),
      );
      expect(harness.getLatest().view.selectedSession.runtimeData.todos[0]?.id).toBe("todo-1");
    } finally {
      await harness.unmount();
    }
  });

  test("loads runtime data only for the visible session when selected and view sessions differ", async () => {
    const readSessionTodos = mock(async ({ externalSessionId }: { externalSessionId: string }) => [
      {
        id: `todo-${externalSessionId}`,
        content: `Todo for ${externalSessionId}`,
        status: "pending" as const,
        priority: "medium" as const,
      },
    ]);
    const activeSession = createSession("task-1", "session-build", {
      role: "build",
      runtimeKind: "opencode",
      workingDirectory: "/repo/task-1",
      status: "running",
    });
    const viewSession = createSession("task-2", "session-qa", {
      role: "qa",
      runtimeKind: "opencode",
      workingDirectory: "/repo/task-2",
      status: "running",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeWorkspaceId,
        workspaceRepoPath,
        sessions: [activeSession, viewSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(activeSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      { readSessionTodos },
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (latest) => latest.view.selectedSession.runtimeData.todos[0]?.id === "todo-session-build",
      );
      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledWith({
        repoPath: workspaceRepoPath,
        runtimeKind: "opencode",
        workingDirectory: "/repo/task-1",
        externalSessionId: "session-build",
        runtimePolicy: { kind: "opencode" },
      });
      readSessionTodos.mockClear();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      await harness.update(
        createBaseArgs({
          activeWorkspaceId,
          workspaceRepoPath,
          sessions: [activeSession, viewSession],
          taskIdParam: "task-1",
          sessionExternalIdParam: sessionExternalIdParam(activeSession),
          hasExplicitRoleParam: true,
          roleFromQuery: "build",
          selectionState: toAgentStudioTaskSelection("task-2"),
        }),
        { readSessionTodos },
      );
      await harness.waitFor(
        (latest) => latest.view.selectedSession.runtimeData.todos[0]?.id === "todo-session-qa",
      );

      expect(readSessionTodos).toHaveBeenCalledTimes(1);
      expect(readSessionTodos).toHaveBeenCalledWith({
        repoPath: workspaceRepoPath,
        runtimeKind: "opencode",
        workingDirectory: "/repo/task-2",
        externalSessionId: "session-qa",
        runtimePolicy: { kind: "opencode" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("suppresses stale query task and session selection while repo boundary reset is pending", async () => {
    const loadRepoRuntimeCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => []);
    const staleSession = createSession("task-1", "session-1", {
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      role: "build",
      status: "running",
    });
    const harness = createHookHarness(
      createBaseArgs({
        isRepoNavigationBoundaryPending: true,
        sessions: [staleSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(staleSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
      }),
      {
        readSessionTodos,
        runtimeDefinitionsContext: {
          loadRepoRuntimeCatalog,
        },
      },
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.selectedSessionFromRoute).toBeNull();
      expect(latest.taskId).toBe("");
      expect(latest.selectedTask).toBeNull();
      expect(latest.resolvedRouteSession).toBeNull();
      expect(latest.view.taskId).toBe("");
      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);
      expect(readSessionTodos).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("uses detached tab workflow default role instead of query role selection", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        selectAgentStudioSelection,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      expect(selectAgentStudioSelection).toHaveBeenCalledWith(toAgentStudioTaskSelection("task-2"));

      await harness.update(
        createBaseArgs({
          taskIdParam: "task-1",
          hasExplicitRoleParam: true,
          roleFromQuery: "build",
          selectionState: toAgentStudioTaskSelection("task-2"),
          selectAgentStudioSelection,
        }),
      );

      const latest = harness.getLatest();
      expect(latest.view.taskId).toBe("task-2");
      expect(latest.view.role).toBe("build");
      expect(latest.view.launchActionId).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });

  test("resolves view session from the UI-active task tab", async () => {
    const sessionTaskOne = createSession("task-1", "session-1", {
      role: "planner",
      startedAt: "2026-02-22T12:00:00.000Z",
      status: "running",
    });
    const sessionTaskTwo = createSession("task-2", "session-2", {
      role: "qa",
      startedAt: "2026-02-22T13:00:00.000Z",
      status: "running",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [sessionTaskOne, sessionTaskTwo],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-1",
      );

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      await harness.update(
        createBaseArgs({
          sessions: [sessionTaskOne, sessionTaskTwo],
          taskIdParam: "task-1",
          hasExplicitRoleParam: false,
          selectionState: toAgentStudioTaskSelection("task-2"),
        }),
      );

      const latest = harness.getLatest();
      expect(latest.view.taskId).toBe("task-2");
      expect(latest.view.selectedSession.loadedSession?.externalSessionId).toBe("session-2");
      expect(latest.view.role).toBe("qa");
      expect(latest.view.launchActionId).toBe("qa_review");
    } finally {
      await harness.unmount();
    }
  });

  test("tab shows working status when newer idle session exists but older session is running", async () => {
    const olderRunningSession = createSession("task-1", "session-old", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "running",
    });
    const newerIdleSession = createSession("task-1", "session-new", {
      role: "build",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [olderRunningSession, newerIdleSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      const task1Tab = latest.taskTabs.find((tab) => tab.taskId === "task-1");
      expect(task1Tab?.status).toBe("working");
    } finally {
      await harness.unmount();
    }
  });

  test("tab shows waiting-input status when a session is idle with pending input", async () => {
    const waitingSession = createSession("task-1", "session-waiting", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [
            {
              header: "Decision",
              question: "Which path should the agent take?",
              options: [{ label: "Continue", description: "Continue the session" }],
            },
          ],
        },
      ],
    });
    const newerIdleSession = createSession("task-1", "session-new", {
      role: "build",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [waitingSession, newerIdleSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      const task1Tab = latest.taskTabs.find((tab) => tab.taskId === "task-1");
      expect(task1Tab?.status).toBe("waiting_input");
    } finally {
      await harness.unmount();
    }
  });

  test("idle session is included in latestSessionByTaskId for navigation", async () => {
    const idleSession = createSession("task-1", "session-idle", {
      role: "build",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [idleSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      const task1Tab = latest.taskTabs.find((tab) => tab.taskId === "task-1");
      expect(task1Tab?.status).toBe("idle");
    } finally {
      await harness.unmount();
    }
  });

  test("defaults to build role for open task even when only optional-role session exists", async () => {
    const specSession = createSession("task-1", "session-spec", {
      role: "spec",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const openTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "open",
      issueType: "task",
      agentWorkflows: {
        spec: {
          required: false,
          canSkip: true,
          available: true,
          completed: false,
        },
        planner: {
          required: false,
          canSkip: true,
          available: true,
          completed: false,
        },
        builder: {
          required: true,
          canSkip: false,
          available: true,
          completed: false,
        },
        qa: {
          required: false,
          canSkip: true,
          available: false,
          completed: false,
        },
      },
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [openTask, createTask("task-2")],
        sessions: [specSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();
      const latest = harness.getLatest();

      expect(latest.view.selectedSession.loadedSession).toBeNull();
      expect(latest.view.role).toBe("build");
      expect(latest.view.launchActionId).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps human_review task pinned to build session when newer qa session appears", async () => {
    const humanReviewTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "human_review",
    });
    const initialBuildSession = createSession("task-1", "session-build", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const newerQaSession = createSession("task-1", "session-qa", {
      role: "qa",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [humanReviewTask, createTask("task-2")],
        sessions: [initialBuildSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");

      await harness.update(
        createBaseArgs({
          tasks: [humanReviewTask, createTask("task-2")],
          sessions: [newerQaSession, initialBuildSession],
          taskIdParam: "task-1",
          sessionExternalIdParam: null,
          hasExplicitRoleParam: false,
        }),
      );

      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");
      expect(harness.getLatest().view.launchActionId).toBe("build_after_human_request_changes");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps human_review view stable on query role changes when session is not explicit", async () => {
    const humanReviewTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "human_review",
    });
    const buildSession = createSession("task-1", "session-build", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const qaSession = createSession("task-1", "session-qa", {
      role: "qa",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [humanReviewTask, createTask("task-2")],
        sessions: [qaSession, buildSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "build",
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");

      await harness.update(
        createBaseArgs({
          tasks: [humanReviewTask, createTask("task-2")],
          sessions: [qaSession, buildSession],
          taskIdParam: "task-1",
          sessionExternalIdParam: null,
          hasExplicitRoleParam: false,
          roleFromQuery: "qa",
        }),
      );

      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");
      expect(harness.getLatest().view.launchActionId).toBe("build_after_human_request_changes");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps build selected after task-tab navigation settles on a human_review task", async () => {
    const selectAgentStudioSelection = mock(() => {});
    const taskOne = createTask("task-1");
    const humanReviewTask = createTaskCardFixture({
      id: "task-2",
      title: "task-2",
      status: "human_review",
    });
    const buildSession = createSession("task-2", "session-build", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const qaSession = createSession("task-2", "session-qa", {
      role: "qa",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [taskOne, humanReviewTask],
        sessions: [buildSession, qaSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        selectAgentStudioSelection,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });
      expect(selectAgentStudioSelection).toHaveBeenCalledWith(toAgentStudioTaskSelection("task-2"));

      await harness.update(
        createBaseArgs({
          tasks: [taskOne, humanReviewTask],
          sessions: [buildSession, qaSession],
          taskIdParam: "task-1",
          sessionExternalIdParam: null,
          hasExplicitRoleParam: false,
          roleFromQuery: "qa",
          selectionState: toAgentStudioTaskSelection("task-2"),
          selectAgentStudioSelection,
        }),
      );

      expect(harness.getLatest().view.taskId).toBe("task-2");
      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");

      await harness.update(
        createBaseArgs({
          tasks: [taskOne, humanReviewTask],
          sessions: [buildSession, qaSession],
          taskIdParam: "task-2",
          sessionExternalIdParam: null,
          hasExplicitRoleParam: false,
          roleFromQuery: "qa",
          selectAgentStudioSelection,
        }),
      );

      expect(harness.getLatest().view.taskId).toBe("task-2");
      expect(harness.getLatest().view.selectedSession.loadedSession?.externalSessionId).toBe(
        "session-build",
      );
      expect(harness.getLatest().view.role).toBe("build");
      expect(harness.getLatest().view.launchActionId).toBe("build_after_human_request_changes");
    } finally {
      await harness.unmount();
    }
  });
});
