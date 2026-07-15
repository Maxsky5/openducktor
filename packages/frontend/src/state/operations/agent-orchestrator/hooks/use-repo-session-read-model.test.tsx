import { describe, expect, mock, test } from "bun:test";
import {
  type AgentSessionRecord,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type PolicyBoundSessionRef,
  toAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import {
  ChecksStateContext,
  RepoRuntimeHealthContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import {
  type RepoSessionReadModelState,
  useRepoSessionReadModel,
} from "./use-repo-session-read-model";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const createHarnessState = () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-2"), []);

  let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
  const observedSessions: PolicyBoundSessionRef[] = [];
  const loadedSessionHistories: PolicyBoundSessionRef[] = [];
  let observeAgentSessionImpl = async (session: PolicyBoundSessionRef): Promise<void> => {
    observedSessions.push(session);
  };
  let loadLiveSessionHistoryImpl = async (session: PolicyBoundSessionRef): Promise<void> => {
    loadedSessionHistories.push(session);
  };
  const listSessionRuntimeSnapshots = mock(
    async (
      _input: Parameters<AgentEnginePort["listSessionRuntimeSnapshots"]>[0],
    ): Promise<Awaited<ReturnType<AgentEnginePort["listSessionRuntimeSnapshots"]>>> => [],
  );
  const agentEngine = { listSessionRuntimeSnapshots };
  const currentWorkspaceRepoPathRef = { current: "/repo" };
  const repoEpochRef = { current: 0 };
  const commitSessionCollection: AgentSessionsStore["commitSessionCollection"] = (commit) => {
    const { collection, result } = commit(sessionCollection);
    sessionCollection = collection;
    return result;
  };
  const observeAgentSession = (session: PolicyBoundSessionRef) => observeAgentSessionImpl(session);
  const loadLiveSessionHistory = (session: PolicyBoundSessionRef) =>
    loadLiveSessionHistoryImpl(session);
  const clearSessionObservationState = mock(() => undefined);
  const readyRuntimeHealthByRuntime: RepoRuntimeHealthMap = {
    opencode: createRepoRuntimeHealthFixture(),
  };
  let runtimeHealthByRuntime = readyRuntimeHealthByRuntime;
  const props = (taskIds: string[]) => {
    return {
      workspaceRepoPath: "/repo",
      taskIds,
      isLoadingTasks: false,
      currentWorkspaceRepoPathRef,
      repoEpochRef,
      commitSessionCollection,
      agentEngine,
      observeAgentSession,
      clearSessionObservationState,
      loadLiveSessionHistory,
      queryClient,
      sessionReadPort: {
        agentSessionsList: async () => {
          throw new Error("Per-task session cache should already be hydrated.");
        },
        agentSessionsListForTasks: async () => {
          throw new Error("Per-task session cache should already be hydrated.");
        },
      },
    };
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <RuntimeDefinitionsContext.Provider
      value={{
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        agentRuntimes: DEFAULT_AGENT_RUNTIMES,
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        refreshRuntimeDefinitions: async () => [
          OPENCODE_RUNTIME_DESCRIPTOR,
          CODEX_RUNTIME_DESCRIPTOR,
        ],
        loadRepoRuntimeCatalog: async () => {
          throw new Error("Test runtime catalog loader was not configured.");
        },
        loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
        loadRepoRuntimeSkills: async () => ({ skills: [] }),
        loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
        loadRepoRuntimeFileSearch: async () => [],
      }}
    >
      <RepoRuntimeHealthContext.Provider
        value={{
          runtimeHealthByRuntime,
          isLoadingRepoRuntimeHealth: false,
          refreshRepoRuntimeHealth: async () => runtimeHealthByRuntime,
        }}
      >
        <ChecksStateContext.Provider
          value={{
            runtimeCheck: null,
            taskStoreCheck: null,
            runtimeCheckFailureKind: null,
            taskStoreCheckFailureKind: null,
            isLoadingChecks: false,
            refreshChecks: async () => undefined,
          }}
        >
          {children}
        </ChecksStateContext.Provider>
      </RepoRuntimeHealthContext.Provider>
    </RuntimeDefinitionsContext.Provider>
  );
  const setRuntimeHealth = (nextRuntimeHealthByRuntime = readyRuntimeHealthByRuntime) => {
    runtimeHealthByRuntime = nextRuntimeHealthByRuntime;
  };
  const createReadModelHarness = (taskIds: string[]) =>
    createHookHarness(useRepoSessionReadModel, props(taskIds), { wrapper });
  const updateReadModelHarness = (
    harness: ReturnType<typeof createReadModelHarness>,
    taskIds: string[],
  ) => harness.update(props(taskIds));
  const setTaskSessionRecords = (taskId: string, records: AgentSessionRecord[]) => {
    queryClient.setQueryData(agentSessionQueryKeys.list("/repo", taskId), records);
  };
  const setObserveAgentSession = (nextObserveAgentSession: typeof observeAgentSessionImpl) => {
    observeAgentSessionImpl = nextObserveAgentSession;
  };
  const setLoadLiveSessionHistory = (
    nextLoadLiveSessionHistory: typeof loadLiveSessionHistoryImpl,
  ) => {
    loadLiveSessionHistoryImpl = nextLoadLiveSessionHistory;
  };
  const getSession = (externalSessionId: string) =>
    listAgentSessions(sessionCollection).find(
      (session) => session.externalSessionId === externalSessionId,
    ) ?? null;

  return {
    setRuntimeHealth,
    setObserveAgentSession,
    setLoadLiveSessionHistory,
    setTaskSessionRecords,
    getSession,
    createReadModelHarness,
    updateReadModelHarness,
    listSessionRuntimeSnapshots,
    observedSessions,
    loadedSessionHistories,
    clearSessionObservationState,
  };
};

const isReadModelReady = (state: RepoSessionReadModelState): boolean =>
  state.sessionReadModelLoadState.kind === "ready";

const isReadModelFailed = (state: RepoSessionReadModelState): boolean =>
  state.sessionReadModelLoadState.kind === "failed";

describe("useRepoSessionReadModel", () => {
  test("does not reload the repo session read model when task metadata changes but task ids do not", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when task ids are reordered", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1", "task-2"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      await state.updateReadModelHarness(harness, ["task-2", "task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when runtime diagnostics change but readiness does not", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      state.setRuntimeHealth({
        opencode: createRepoRuntimeHealthFixture({
          checkedAt: "2026-06-12T08:01:00.000Z",
          mcp: { toolIds: ["odt_read_task", "odt_set_plan"] },
          runtime: { updatedAt: "2026-06-12T08:01:00.000Z" },
        }),
      });
      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when an unused runtime changes readiness", async () => {
    const state = createHarnessState();
    state.setRuntimeHealth({
      opencode: createRepoRuntimeHealthFixture(),
      codex: createRepoRuntimeHealthFixture(),
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      state.setRuntimeHealth({
        opencode: createRepoRuntimeHealthFixture(),
        codex: createRepoRuntimeHealthFixture(
          {},
          {
            status: "checking",
            runtime: {
              status: "checking",
              stage: "waiting_for_runtime",
            },
            mcp: {
              status: "waiting_for_runtime",
            },
          },
        ),
      });
      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("reloads the repo session read model when the task id set changes", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      await state.updateReadModelHarness(harness, ["task-1", "task-2"]);
      await harness.waitFor(() => state.listSessionRuntimeSnapshots.mock.calls.length === 2);

      expect(harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await harness.unmount();
    }
  });

  test("recovers from a transient snapshot failure when explicitly reloaded", async () => {
    const state = createHarnessState();
    let snapshotAttempts = 0;
    state.listSessionRuntimeSnapshots.mockImplementation(async () => {
      snapshotAttempts += 1;
      if (snapshotAttempts === 1) {
        throw new Error("temporary runtime startup race");
      }

      return [
        toAgentSessionRuntimeSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: record.workingDirectory,
            externalSessionId: record.externalSessionId,
          },
          snapshot: {
            title: "OpenCode Builder",
            startedAt: record.startedAt,
            runtimeActivity: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          },
        }),
      ];
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelFailed);

      expect(harness.getLatest().sessionReadModelLoadState).toEqual(
        expect.objectContaining({
          kind: "failed",
          message: expect.stringContaining("temporary runtime startup race"),
        }),
      );
      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      await harness.run((readModel) => {
        readModel.reloadSessionReadModel();
      });
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(2);
      expect(state.getSession(record.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: record.externalSessionId,
          status: "running",
          runtimeKind: "opencode",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the repo session read model ready when one live observer fails", async () => {
    const state = createHarnessState();
    state.listSessionRuntimeSnapshots.mockImplementation(async () => [
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: record.workingDirectory,
          externalSessionId: record.externalSessionId,
        },
        snapshot: {
          title: "OpenCode Builder",
          startedAt: record.startedAt,
          runtimeActivity: "running",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      }),
    ]);
    state.setObserveAgentSession(async (session) => {
      state.observedSessions.push(session);
      throw new Error("observer refused");
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
      expect(state.getSession(record.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: record.externalSessionId,
          status: "error",
        }),
      );
      expect(state.getSession(record.externalSessionId)?.messages.items.at(-1)).toEqual(
        expect.objectContaining({
          role: "system",
          content: "Failed to observe live session: observer refused",
          meta: expect.objectContaining({
            kind: "session_notice",
            reason: "session_error",
          }),
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the repo session read model loading until detected live session history is loaded", async () => {
    const state = createHarnessState();
    let resolveHistoryLoad!: () => void;
    const historyLoadCompleted = new Promise<void>((resolve) => {
      resolveHistoryLoad = resolve;
    });
    state.listSessionRuntimeSnapshots.mockImplementation(async () => [
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: record.workingDirectory,
          externalSessionId: record.externalSessionId,
        },
        snapshot: {
          title: "OpenCode Builder",
          startedAt: record.startedAt,
          runtimeActivity: "running",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      }),
    ]);
    state.setLoadLiveSessionHistory(async (session) => {
      state.loadedSessionHistories.push(session);
      await historyLoadCompleted;
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(() => state.loadedSessionHistories.length === 1);

      expect(harness.getLatest().sessionReadModelLoadState.kind).toBe("loading");
      expect(state.loadedSessionHistories).toEqual([
        {
          repoPath: "/repo",
          externalSessionId: record.externalSessionId,
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          workingDirectory: record.workingDirectory,
        },
      ]);

      resolveHistoryLoad();
      await harness.waitFor(isReadModelReady);

      expect(harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      resolveHistoryLoad();
      await harness.unmount();
    }
  });

  test("loads persisted sessions while their runtime is still starting", async () => {
    const state = createHarnessState();
    const loadingRuntimeHealthByRuntime = {
      opencode: createRepoRuntimeHealthFixture(
        {},
        {
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
          },
          mcp: {
            status: "waiting_for_runtime",
          },
        },
      ),
    };
    state.setRuntimeHealth(loadingRuntimeHealthByRuntime);
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).not.toHaveBeenCalled();
      expect(state.getSession(record.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: record.externalSessionId,
          status: "idle",
          runtimeKind: "opencode",
        }),
      );

      state.setRuntimeHealth();
      await state.updateReadModelHarness(harness, ["task-1"]);
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("loads persisted sessions without scanning a blocked runtime", async () => {
    const state = createHarnessState();
    state.setRuntimeHealth({
      opencode: createRepoRuntimeHealthFixture({
        status: "error",
        runtime: {
          status: "error",
          stage: "startup_failed",
          detail: "OpenCode runtime startup failed.",
          failureKind: "error",
        },
      }),
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(harness.getLatest().sessionReadModelLoadState).toEqual(
        expect.objectContaining({
          kind: "ready",
        }),
      );
      expect(state.listSessionRuntimeSnapshots).not.toHaveBeenCalled();
      expect(state.getSession(record.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: record.externalSessionId,
          status: "idle",
          runtimeKind: "opencode",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("loads healthy runtime sessions when another persisted runtime is blocked", async () => {
    const state = createHarnessState();
    const codexRecord: AgentSessionRecord = {
      ...record,
      externalSessionId: "codex-session",
      runtimeKind: "codex",
      workingDirectory: "/repo/codex-worktree",
      startedAt: "2026-06-12T08:01:00.000Z",
    };
    state.setTaskSessionRecords("task-2", [codexRecord]);
    state.setRuntimeHealth({
      opencode: createRepoRuntimeHealthFixture(),
      codex: createRepoRuntimeHealthFixture({
        status: "error",
        runtime: {
          status: "error",
          stage: "startup_failed",
          detail: "Codex runtime startup failed.",
          failureKind: "error",
        },
      }),
    });
    state.listSessionRuntimeSnapshots.mockImplementation(async (input) => {
      if (input.runtimeKind !== "opencode") {
        throw new Error(`Unexpected snapshot scan for ${input.runtimeKind}`);
      }
      return [
        toAgentSessionRuntimeSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: record.workingDirectory,
            externalSessionId: record.externalSessionId,
          },
          snapshot: {
            title: "OpenCode Builder",
            startedAt: record.startedAt,
            runtimeActivity: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          },
        }),
      ];
    });
    const harness = state.createReadModelHarness(["task-1", "task-2"]);

    try {
      await harness.mount();
      await harness.waitFor(isReadModelReady);

      expect(state.listSessionRuntimeSnapshots.mock.calls).toHaveLength(1);
      expect(state.listSessionRuntimeSnapshots.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          runtimeKind: "opencode",
          directories: [record.workingDirectory],
        }),
      );
      expect(state.getSession(record.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: record.externalSessionId,
          status: "running",
          runtimeKind: "opencode",
        }),
      );
      expect(state.getSession(codexRecord.externalSessionId)).toEqual(
        expect.objectContaining({
          externalSessionId: codexRecord.externalSessionId,
          status: "idle",
          runtimeKind: "codex",
        }),
      );
      expect(state.observedSessions).toEqual([
        {
          repoPath: "/repo",
          externalSessionId: record.externalSessionId,
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          workingDirectory: record.workingDirectory,
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });
});
