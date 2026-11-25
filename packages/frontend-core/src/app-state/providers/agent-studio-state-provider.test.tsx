import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { type PropsWithChildren, useSyncExternalStore } from "react";
import type { ClientConnection } from "../../connection/client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { HostUnreachableError } from "@openducktor/host-client";
import { createOpenCodeAgentEngineTestAdapter } from "../../sessions/agent-orchestrator/handlers/opencode-agent-engine.test-support";
import { useSelectedSessionHistoryLoad } from "../../sessions/agent-orchestrator/history/use-selected-session-history-load";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
import { useSessionBackgroundTasks } from "../../sessions/background-tasks/use-session-background-tasks";
import {
  useAgentSessionReadModelStateContext,
  useAgentSessionsContext,
} from "../../sessions/session-contexts";
import { AgentRuntimeTestAdapter } from "../../test-support/agent-runtime-test-adapter";
import { createLiveSnapshotEnvelope } from "../../test-support/agent-session-live-fixture";
import { createHookHarness } from "../../test-support/react-hook-harness";
import {
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
} from "../../test-support/shared-test-fixtures";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../../test-support/test-client-connection";
import {
  TaskControlContext,
  TaskSnapshotContext,
  WorkspaceScopeContext,
  type WorkspaceScopeContextValue,
} from "../app-state-contexts";
import { AgentStudioStateProvider } from "./agent-studio-state-provider";
import { WorkspaceActivityProvider } from "./workspace-activity-provider";

const workspaceA = createWorkspaceRecordFixture({ workspaceId: "a", repoPath: "/a" });
const workspaceB = createWorkspaceRecordFixture({ workspaceId: "b", repoPath: "/b" });
const record = (repoPath: string): WorkspaceSession => ({
  id: `chat-${repoPath}`,
  externalSessionId: "same-native-id",
  runtimeKind: "opencode",
  executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
  selectedModel: { runtimeKind: "opencode", providerId: "test", modelId: "turn-model" },
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: repoPath,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
  targetBranch: null,
});
const live = (repoPath: string): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath,
    externalSessionId: "same-native-id",
    runtimeKind: "opencode",
    workingDirectory: repoPath,
  },
  title: repoPath,
  activity: "idle",
  startedAt: new Date(1000).toISOString(),
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const createEngine = () => ({
  ...createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter()),
  loadSessionHistory: mock(async (): Promise<AgentSessionHistoryMessage[]> => [
    {
      messageId: "history-1",
      role: "assistant",
      text: "History",
      parts: [],
      timestamp: new Date(1000).toISOString(),
    },
  ]),
});

// The providers read only the workspace scope, so these tests supply no workspace administration.
const createProviders = (
  connection: ClientConnection,
  readScope: () => WorkspaceScopeContextValue,
) => {
  const engine = createEngine();
  return ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceScopeContext.Provider value={readScope()}>
        <TaskSnapshotContext.Provider value={{ tasks: [], isLoadingTasks: false }}>
          <TaskControlContext.Provider
            value={{
              refreshTaskData: async () => {},
              loadWorkspaceTasks: async () => {},
              refreshTasksWithOptions: async () => {},
              clearTaskData: () => {},
              setIsLoadingTasks: () => {},
            }}
          >
            <WorkspaceActivityProvider>
              <AgentStudioStateProvider agentEngine={engine}>{children}</AgentStudioStateProvider>
            </WorkspaceActivityProvider>
          </TaskControlContext.Provider>
        </TaskSnapshotContext.Provider>
      </WorkspaceScopeContext.Provider>
    </ClientConnectionProvider>
  );
};

const createHarness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const stops = new Map<string, number>();
  const observe = mock(
    async (
      { repoPath }: { repoPath: string },
      listener: (envelope: AgentSessionLiveEnvelope) => void,
    ) => {
      listener(createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }));
      return () => {
        stops.set(repoPath, (stops.get(repoPath) ?? 0) + 1);
      };
    },
  );
  const connection = createTestClientConnection({
    queryClient: client,
    host: createTestHostConnection({
      observeAgentSessionLive: observe,
      client: {
        tasksList: async () => [],
        workspaceSessionListActive: async (id) => [record(`/${id}`)],
        agentSessionLiveAttach: async ({ repoPath }) =>
          createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }),
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    }),
  });
  let scope: WorkspaceScopeContextValue = {
    workspaces: [workspaceA, workspaceB],
    activeWorkspace: workspaceA,
  };
  const wrapper = createProviders(connection, () => scope);
  const harness = createHookHarness(
    () => {
      const store = useAgentSessionsContext();
      const identity = live(scope.activeWorkspace!.repoPath).ref;
      const session = useSyncExternalStore(store.subscribe, () =>
        store.getSessionSnapshot(identity),
      );
      useSelectedSessionHistoryLoad({ session, runtimeReadinessState: "ready" });
      return { session };
    },
    undefined,
    { wrapper, reactStrictMode: true },
  );
  return {
    ...harness,
    observe,
    stops,
    select: async (next: typeof workspaceA) => {
      scope = { ...scope, activeWorkspace: next };
      await harness.update(undefined);
    },
    dispose: async () => {
      await harness.unmount();
      client.clear();
    },
  };
};

test("strict mode releases replaced observations and keeps workspace controllers alive on selection", async () => {
  const state = createHarness();
  try {
    await state.mount();
    await state.waitFor(({ session }) => session?.historyLoadState === "loaded");
    const observations = state.observe.mock.calls.length;
    expect(observations).toBe(4);
    await state.select(workspaceB);
    await state.waitFor(({ session }) => session?.historyLoadState === "loaded");
    await state.select(workspaceA);
    expect(state.observe).toHaveBeenCalledTimes(observations);
    for (const repoPath of ["/a", "/b"]) {
      const opened = state.observe.mock.calls.filter(
        ([input]) => input.repoPath === repoPath,
      ).length;
      expect(opened - (state.stops.get(repoPath) ?? 0)).toBe(1);
    }
  } finally {
    await state.dispose();
  }
  expect([...state.stops.values()].reduce((total, count) => total + count, 0)).toBe(
    state.observe.mock.calls.length,
  );
});

test("an unresolved live-stream failure wins over a workspace task-list failure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const background = (sequence: number) =>
    createLiveSnapshotEnvelope({
      repoPath: "/a",
      sequence,
      sessions: [
        {
          ...live("/a"),
          activity: "running",
          foregroundTurnActive: false,
          backgroundTasks: [
            { taskId: "shell-1", kind: "command", title: "bun run dev", stop: { allowed: true } },
          ],
        },
      ],
    });
  let emit: (envelope: AgentSessionLiveEnvelope) => void = () => {};
  let taskListFailure: Error | null = null;
  let taskListReads = 0;
  const stopInputs: unknown[] = [];
  const attach = mock(async () => background(1));
  const connection = createTestClientConnection({
    queryClient: client,
    host: createTestHostConnection({
      observeAgentSessionLive: async (_input, listener) => {
        emit = listener;
        listener(background(1));
        return () => {};
      },
      client: {
        tasksList: async () => {
          taskListReads += 1;
          if (taskListFailure) throw taskListFailure;
          return [];
        },
        workspaceSessionListActive: async () => [record("/a")],
        agentSessionLiveAttach: attach,
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        agentSessionBackgroundTaskStop: async (input) => {
          stopInputs.push(input);
        },
      },
    }),
  });
  const scope: WorkspaceScopeContextValue = {
    workspaces: [workspaceA],
    activeWorkspace: workspaceA,
  };
  const state = createHookHarness(
    () => ({
      taskListFailed: useQuery(repoTaskDataQueryOptions(workspaceA), client).isError,
      readModel: useAgentSessionReadModelStateContext(),
      bar: useSessionBackgroundTasks({ repoPath: "/a", identity: live("/a").ref }),
    }),
    undefined,
    { wrapper: createProviders(connection, () => scope) },
  );
  const titles = () => state.getLatest().bar?.rows.map((row) => row.title) ?? null;

  try {
    await state.mount();
    await state.waitFor(({ bar }) => bar !== null);
    expect(state.getLatest().readModel.sessionReadModelLoadState.kind).toBe("ready");
    expect(titles()).toEqual(["bun run dev"]);
    const confirmedStop = state.getLatest().bar?.onStop;
    if (!confirmedStop) throw new Error("The bar has a running task.");

    await state.run(() => emit({ type: "fault", repoPath: "/a", message: "Stream stopped." }));
    await state.waitFor(({ bar }) => bar === null);

    // The task list fails while no new snapshot has confirmed the live state.
    taskListFailure = new Error("task list unavailable");
    await state.run(async () => {
      await client.refetchQueries({ queryKey: repoTaskDataQueryOptions(workspaceA).queryKey });
    });
    await state.waitFor(({ taskListFailed }) => taskListFailed);
    expect(state.getLatest().readModel.sessionReadModelLoadState).toMatchObject({
      kind: "failed",
      source: "live-stream",
      message: "Live-session observation failed: Stream stopped.",
    });
    expect(titles()).toBeNull();
    await state.run(() => confirmedStop("shell-1"));
    expect(stopInputs).toEqual([]);

    // Retry reads the task list again and restarts the live observation. Its fresh snapshot
    // confirms the live state, so the task-list failure shows and the rows return.
    const attaches = attach.mock.calls.length;
    const reads = taskListReads;
    await state.run(({ readModel }) => readModel.reloadSessionReadModel());
    await state.waitFor(
      ({ readModel }) =>
        readModel.sessionReadModelLoadState.kind === "failed" &&
        readModel.sessionReadModelLoadState.source === "task-records",
    );
    expect(attach.mock.calls.length).toBeGreaterThan(attaches);
    expect(taskListReads).toBeGreaterThan(reads);
    expect(state.getLatest().readModel.sessionReadModelLoadState).toMatchObject({
      message: "Failed to load workspace tasks: task list unavailable",
    });
    expect(titles()).toEqual(["bun run dev"]);

    taskListFailure = null;
    await state.run(({ readModel }) => readModel.reloadSessionReadModel());
    await state.waitFor(({ readModel }) => readModel.sessionReadModelLoadState.kind === "ready");
    expect(titles()).toEqual(["bun run dev"]);
  } finally {
    await state.unmount();
    client.clear();
  }
});

test("waits quietly when the workspace task list lost the host", async () => {
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      observeAgentSessionLive: async ({ repoPath }, listener) => {
        listener(createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }));
        return () => {};
      },
      client: {
        tasksList: async () => {
          throw new HostUnreachableError(new TypeError("Failed to fetch"));
        },
        workspaceSessionListActive: async () => [record("/a")],
        agentSessionLiveAttach: async ({ repoPath }) =>
          createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }),
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    }),
  });
  const scope: WorkspaceScopeContextValue = {
    workspaces: [workspaceA],
    activeWorkspace: workspaceA,
  };
  const state = createHookHarness(() => useAgentSessionReadModelStateContext(), undefined, {
    wrapper: createProviders(connection, () => scope),
  });
  try {
    await state.mount();
    await state.waitFor(
      ({ sessionReadModelLoadState }) => sessionReadModelLoadState.kind === "failed",
    );
    expect(state.getLatest().sessionReadModelLoadState).toMatchObject({
      source: "task-records",
      failureKind: "host-unreachable",
    });
  } finally {
    await state.unmount();
    connection.queryClient.clear();
  }
});
