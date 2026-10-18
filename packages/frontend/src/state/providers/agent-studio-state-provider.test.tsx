import { expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, useSyncExternalStore } from "react";
import { projectWorkspaceSessionLaunch } from "@/pages/workspace-sessions/launch-workspace-session";
import { useAgentChatTranscriptModel } from "@/components/features/agents/agent-chat/use-agent-chat-transcript-model";
import { AgentChatTranscriptCacheProvider } from "@/components/features/agents/agent-chat/agent-chat-transcript-cache-provider";
import { toAgentChatTranscriptSession } from "@/components/features/agents/agent-chat/agent-chat-transcript-session";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import {
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { createLiveSnapshotEnvelope } from "@openducktor/frontend-core/test-support/agent-session-live-fixture";
import { AgentRuntimeTestAdapter } from "@openducktor/frontend-core/test-support/agent-runtime-test-adapter";
import { createOpenCodeAgentEngineTestAdapter } from "@openducktor/frontend-core/sessions/agent-orchestrator/handlers/opencode-agent-engine.test-support";
import { useSelectedSessionHistoryLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-history-load";
import { projectWorkflowLaunch } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workflow-launch-projection";
import {
  TaskControlContext,
  TaskSnapshotContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import {
  useAgentOperationsContext,
  useAgentSessionReadModelStateContext,
  useAgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
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

const createHarness = (history?: Promise<AgentSessionHistoryMessage[]>, strict = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const listeners = new Map<string, Set<(envelope: AgentSessionLiveEnvelope) => void>>();
  const stops = new Map<string, number>();
  const observe = mock(
    async (
      { repoPath }: { repoPath: string },
      listener: (envelope: AgentSessionLiveEnvelope) => void,
    ) => {
      const consumers = listeners.get(repoPath) ?? new Set();
      consumers.add(listener);
      listeners.set(repoPath, consumers);
      listener(createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }));
      return () => {
        consumers.delete(listener);
        stops.set(repoPath, (stops.get(repoPath) ?? 0) + 1);
      };
    },
  );
  const attach = mock(async ({ repoPath }: { repoPath: string }) =>
    createLiveSnapshotEnvelope({ repoPath, sequence: 1, sessions: [live(repoPath)] }),
  );
  const loadHistory = mock(
    async (): Promise<AgentSessionHistoryMessage[]> =>
      history ??
      Array.from({ length: 300 }, (_, index) => ({
        messageId: `history-${index}`,
        role: "assistant",
        text: `History ${index}`,
        parts: [],
        timestamp: new Date(1000 + index).toISOString(),
      })),
  );
  const engine = {
    ...createOpenCodeAgentEngineTestAdapter(new AgentRuntimeTestAdapter()),
    loadSessionHistory: loadHistory,
    submitUserMessage: mock(async () => ({
      kind: "accepted" as const,
      acceptedMessage: {
        type: "user_message" as const,
        externalSessionId: "same-native-id",
        messageId: "turn-user",
        message: "Start",
        parts: [{ kind: "text" as const, text: "Start" }],
        state: "read" as const,
        timestamp: "2026-10-18T10:00:00.000Z",
      },
    })),
  };
  const connection = createTestClientConnection({
    queryClient: client,
    host: createTestHostConnection({
      observeAgentSessionLive: observe,
      client: {
        tasksList: async () => [],
        workspaceSessionListActive: async (id) => [record(`/${id}`)],
        agentSessionLiveAttach: attach,
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    }),
  });
  let workspace = createWorkspaceStateFixture({
    workspaces: [workspaceA, workspaceB],
    activeWorkspace: workspaceA,
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ClientConnectionProvider connection={connection}>
      <WorkspaceStateContext.Provider value={workspace}>
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
              <AgentStudioStateProvider agentEngine={engine}>
                <AgentChatTranscriptCacheProvider>{children}</AgentChatTranscriptCacheProvider>
              </AgentStudioStateProvider>
            </WorkspaceActivityProvider>
          </TaskControlContext.Provider>
        </TaskSnapshotContext.Provider>
      </WorkspaceStateContext.Provider>
    </ClientConnectionProvider>
  );
  const observed: Array<{ repo: string; state: string; currentRows: boolean }> = [];
  const harness = createHookHarness(
    () => {
      const store = useAgentSessionsContext();
      const readModel = useAgentSessionReadModelStateContext();
      const operations = useAgentOperationsContext();
      const identity = live(workspace.activeWorkspace!.repoPath).ref;
      const session = useSyncExternalStore(store.subscribe, () =>
        store.getSessionSnapshot(identity),
      );
      useSelectedSessionHistoryLoad({ session, runtimeReadinessState: "ready" });
      if (session?.historyLoadFailure) throw new Error(JSON.stringify(session.historyLoadFailure));
      const transcript = useAgentChatTranscriptModel({
        session: session ? toAgentChatTranscriptSession(session) : null,
        showThinkingMessages: true,
      });
      observed.push({
        repo: identity.repoPath,
        state: readModel.sessionReadModelLoadState.kind,
        currentRows: transcript.hasCurrentRowsForActiveSession,
      });
      return { store, readModel, session, operations, transcript };
    },
    undefined,
    { wrapper, reactStrictMode: strict },
  );
  return {
    ...harness,
    client,
    observe,
    attach,
    loadHistory,
    stops,
    observed,
    emit: (repoPath: string, envelope: AgentSessionLiveEnvelope) => {
      const consumers = listeners.get(repoPath);
      if (!consumers?.size) throw new Error(`Workspace ${repoPath} has no stream.`);
      for (const listener of consumers) listener(envelope);
    },
    select: async (next: typeof workspaceA, workspaces = workspace.workspaces) => {
      workspace = { ...workspace, activeWorkspace: next, workspaces };
      await harness.update(undefined);
    },
    dispose: async () => {
      await harness.unmount();
      client.clear();
    },
  };
};

test("keeps background transcripts, turn facts, faults, and warmed rows through workspace switches", async () => {
  const state = createHarness();
  const a = live("/a");
  try {
    await state.mount();
    await state.waitFor(
      ({ session, transcript }) =>
        session?.historyLoadState === "loaded" && transcript.hasCurrentRowsForActiveSession,
    );
    await state.run(async () => {
      await state.getLatest().operations.sendAgentMessage(a.ref, [{ kind: "text", text: "Start" }]);
    });
    await state.run(() =>
      state.emit("/a", {
        type: "transcript_event",
        event: {
          type: "user_message",
          parts: [{ kind: "text", text: "Start" }],
          state: "read",
          sessionRef: a.ref,
          externalSessionId: a.ref.externalSessionId,
          messageId: "turn-user",
          message: "Start",
          timestamp: "2026-10-18T10:00:00.000Z",
          model: { providerId: "test", modelId: "turn-model" },
        },
      }),
    );
    await state.select(workspaceB);
    expect(state.getLatest().readModel.sessionReadModelLoadState.kind).toBe("ready");
    await state.run(async () => {
      const receipt = await state
        .getLatest()
        .operations.sendAgentMessage(live("/b").ref, [
          { kind: "text", text: "Send after switching" },
        ]);
      expect(receipt?.outcome).toBe("accepted");
    });
    await state.waitFor(
      ({ session, transcript }) =>
        session?.historyLoadState === "loaded" && transcript.hasCurrentRowsForActiveSession,
    );
    const historyReads = state.loadHistory.mock.calls.length;
    await state.run(() => {
      state.emit("/a", {
        type: "transcript_event",
        event: {
          type: "assistant_message",
          sessionRef: a.ref,
          externalSessionId: a.ref.externalSessionId,
          messageId: "background-answer",
          message: "Received while away",
          timestamp: "2026-10-18T10:00:04.000Z",
        },
      });
      state.emit("/a", {
        type: "session_upsert",
        session: { ...a, contextUsage: { totalTokens: 42 } },
      });
    });
    const rendersBeforeReturn = state.observed.length;
    await state.select(workspaceA);
    const returned = state.getLatest();
    expect(returned.session?.historyLoadState).toBe("loaded");
    expect(returned.session?.contextUsage?.totalTokens).toBe(42);
    expect(
      returned.session?.messages.items.find((message) => message.id === "background-answer"),
    ).toMatchObject({
      content: "Received while away",
      meta: { durationMs: 4000, modelId: "turn-model" },
    });
    expect(
      state.observed
        .slice(rendersBeforeReturn)
        .filter(({ repo }) => repo === "/a")
        .every(({ state: load, currentRows }) => load === "ready" && currentRows),
    ).toBe(true);
    expect(state.loadHistory.mock.calls.length).toBe(historyReads);
    expect(state.observe.mock.calls.map(([input]) => input.repoPath).sort()).toEqual(["/a", "/b"]);
    expect(state.attach).toHaveBeenCalledTimes(2);
    await state.run(() =>
      state.emit("/a", { type: "fault", repoPath: "/a", ref: a.ref, message: "Read failed" }),
    );
    await state.select(workspaceB);
    await state.select(workspaceA);
    expect(state.getLatest().readModel.getSessionFault(a.ref)?.message).toContain("Read failed");
  } finally {
    await state.dispose();
  }
});

test("finishes history and projects launch results into an inactive open workspace, then releases it on close", async () => {
  const pending = Promise.withResolvers<AgentSessionHistoryMessage[]>();
  const state = createHarness(pending.promise);
  const a = live("/a");
  try {
    await state.mount();
    await state.waitFor(({ session }) => session?.historyLoadState === "loading");
    const store = state.getLatest().store;
    await state.select(workspaceB);
    await state.run(() => {
      pending.resolve([
        {
          messageId: "loaded-away",
          role: "assistant",
          text: "History completed",
          parts: [],
          timestamp: new Date(1000).toISOString(),
        },
      ]);
      projectWorkflowLaunch(store, state.client, {
        status: "completed",
        repoPath: "/a",
        workspaceId: "a",
        taskId: "autopilot-task",
        role: "build",
        session: {
          runtimeKind: "opencode",
          workingDirectory: "/a/worktree",
          externalSessionId: "autopilot-session",
          startedAt: new Date(1000).toISOString(),
          status: "running",
        },
      });
      projectWorkspaceSessionLaunch(
        {
          status: "completed",
          repoPath: "/a",
          workspaceId: "a",
          sessionId: record("/a").id,
          record: record("/a"),
          session: { ...a.ref, startedAt: a.startedAt, status: "running" },
          acceptedMessage: {
            type: "user_message",
            parts: [{ kind: "text", text: "Launch accepted" }],
            state: "read",
            externalSessionId: a.ref.externalSessionId,
            messageId: "launch-input",
            message: "Launch accepted",
            timestamp: new Date(2000).toISOString(),
          },
        },
        store,
        state.client,
      );
    });
    await state.select(workspaceA);
    expect(state.getLatest().session?.historyLoadState).toBe("loaded");
    expect(state.getLatest().session?.messages.items.map(({ content }) => content)).toContain(
      "History completed",
    );
    expect(state.getLatest().session?.messages.items.map(({ content }) => content)).toContain(
      "Launch accepted",
    );
    expect(
      store
        .listSessionSnapshots()
        .some(({ externalSessionId }) => externalSessionId === "autopilot-session"),
    ).toBe(true);
    await state.select(workspaceB);
    await state.run(() => store.removeTaskSessions("/a", ["autopilot-task"]));
    expect(store.listSessionTaskIds("/a")).toEqual([]);
    expect(store.getSessionSource(a.ref)).not.toBeNull();
    expect(store.getWorkspaceStore("/a")?.listSessionSnapshots()).toHaveLength(1);
    expect(store.getWorkspaceStore("/b")?.listSessionSnapshots()).toHaveLength(1);
    await state.select(workspaceB, [workspaceB]);
    expect(state.stops.get("/a")).toBe(1);
    expect(store.listSessionTaskIds("/a")).toEqual([]);
    expect(store.getWorkspaceStore("/a")).toBeNull();
    expect(store.getSessionSource(a.ref)).toBeNull();
  } finally {
    await state.dispose();
  }
});

test("strict mode releases replaced observations and keeps workspace controllers alive on selection", async () => {
  const state = createHarness(undefined, true);
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

test("shows fresh history when a closed workspace reopens with the same message count", async () => {
  const state = createHarness();
  try {
    await state.mount();
    await state.waitFor(
      ({ session, transcript }) =>
        session?.historyLoadState === "loaded" && transcript.hasCurrentRowsForActiveSession,
    );
    await state.select(workspaceB);
    await state.waitFor(
      ({ session, transcript }) =>
        session?.historyLoadState === "loaded" && transcript.hasCurrentRowsForActiveSession,
    );
    await state.select(workspaceB, [workspaceB]);
    state.loadHistory.mockImplementation(async () =>
      Array.from({ length: 300 }, (_, index) => ({
        messageId: `history-${index}`,
        role: "assistant" as const,
        text: `Updated ${index}`,
        parts: [],
        timestamp: new Date(1000 + index).toISOString(),
      })),
    );

    await state.select(workspaceA, [workspaceA, workspaceB]);
    await state.waitFor(
      ({ session, transcript }) =>
        session?.historyLoadState === "loaded" && transcript.hasCurrentRowsForActiveSession,
    );
    const { session, transcript } = state.getLatest();
    expect(session?.messages.items[0]?.content).toBe("Updated 0");
    expect(transcript.transcriptState.rows.find((row) => row.kind === "message")).toMatchObject({
      message: { content: "Updated 0" },
    });
  } finally {
    await state.dispose();
  }
});
