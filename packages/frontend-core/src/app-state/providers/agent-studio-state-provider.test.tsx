import "../../test-support/dom-environment";
import { expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, useSyncExternalStore } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createOpenCodeAgentEngineTestAdapter } from "../../sessions/agent-orchestrator/handlers/opencode-agent-engine.test-support";
import { useSelectedSessionHistoryLoad } from "../../sessions/agent-orchestrator/history/use-selected-session-history-load";
import { useAgentSessionsContext } from "../../sessions/session-contexts";
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

// The providers read only the workspace scope, so this test supplies no workspace administration.
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
  const engine = {
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
  };
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
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceScopeContext.Provider value={scope}>
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
