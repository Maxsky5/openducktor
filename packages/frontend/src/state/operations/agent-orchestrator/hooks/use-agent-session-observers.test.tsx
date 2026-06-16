import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionCollection, listAgentSessions } from "@/state/agent-session-collection";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createNoopEngine,
  createSession,
  createTaskFixture,
} from "./agent-session-hook-test-fixtures";
import { useAgentSessionObservers } from "./use-agent-session-observers";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentSessionObservers", () => {
  test("subscribes with the runtime session route after reload", async () => {
    const subscribeEvents = mock(async () => () => undefined);
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        workspaceRepoPath: "/tmp/repo",
        tasks: [createTaskFixture()],
      });
      const observers = useAgentSessionObservers({
        agentEngine: createNoopEngine({
          subscribeEvents,
          listRuntimeDefinitions: () => [],
        }),
        sessionObserversRef: state.sessionObserversRef,
        sessionTransientState: state.sessionTransientState,
        readSessions: state.sessionStore.getSessionsSnapshot,
        readSession: state.sessionStore.getSessionSnapshot,
        setSessionCollection: state.sessionStore.setSessionCollection,
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { observers };
    };

    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    const sessionRef = {
      externalSessionId: "external-1",
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    } as const;

    await harness.run(async ({ observers }) => {
      await observers.observeAgentSession(sessionRef);
    });

    expect(subscribeEvents).toHaveBeenCalledWith(sessionRef, expect.any(Function));

    await harness.unmount();
  });

  test("subscribes once for the same session identity", async () => {
    const unsubscribe = mock(() => undefined);
    const subscribeEvents = mock(async () => unsubscribe);
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        workspaceRepoPath: "/tmp/repo",
        tasks: [createTaskFixture()],
      });
      const observers = useAgentSessionObservers({
        agentEngine: createNoopEngine({
          subscribeEvents,
          listRuntimeDefinitions: () => [],
        }),
        sessionObserversRef: state.sessionObserversRef,
        sessionTransientState: state.sessionTransientState,
        readSessions: state.sessionStore.getSessionsSnapshot,
        readSession: state.sessionStore.getSessionSnapshot,
        setSessionCollection: state.sessionStore.setSessionCollection,
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { state, observers };
    };

    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    const sessionRef = {
      externalSessionId: "external-1",
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    } as const;

    await harness.run(async ({ observers }) => {
      await observers.observeAgentSession(sessionRef);
      await observers.observeAgentSession(sessionRef);
    });

    const observers = harness.getLatest().state.sessionObserversRef.current;
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    expect(observers.has(sessionRef)).toBe(true);

    await harness.unmount();
  });

  test("removal clears subscriptions, drafts, turn timing, and session state", async () => {
    const unsubscribe = mock(() => undefined);
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        workspaceRepoPath: "/tmp/repo",
        tasks: [createTaskFixture()],
      });
      const observers = useAgentSessionObservers({
        agentEngine: createNoopEngine(),
        sessionObserversRef: state.sessionObserversRef,
        sessionTransientState: state.sessionTransientState,
        readSessions: state.sessionStore.getSessionsSnapshot,
        readSession: state.sessionStore.getSessionSnapshot,
        setSessionCollection: state.sessionStore.setSessionCollection,
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { state, observers };
    };
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run(({ state }) => {
      const session = createSession();
      const sessionKey = agentSessionIdentityKey(session);
      state.sessionStore.setSessionCollection(createAgentSessionCollection([session]));
      state.sessionObserversRef.current.add(
        {
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
        unsubscribe,
      );
      state.sessionTransientState.draftBuffers.writeChannel(sessionKey, "reasoning", {
        raw: "draft",
        source: "delta",
        messageId: "message-1",
      });
      state.sessionTransientState.assistantTurnTiming.recordTurnUserMessageTimestamp(sessionKey, 1);
      state.sessionTransientState.turnMetadata.recordModel(sessionKey, null);
    });
    const removedSession = {
      externalSessionId: "external-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const removedSessionKey = agentSessionIdentityKey(removedSession);
    await harness.run(({ observers }) => observers.removeAgentSession(removedSession));
    const { state } = harness.getLatest();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      state.sessionObserversRef.current.has({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).toBe(false);
    expect(
      state.sessionTransientState.draftBuffers.readChannel(removedSessionKey, "reasoning").raw,
    ).toBe("");
    expect(
      state.sessionTransientState.assistantTurnTiming.readTurnUserMessageStartedAtMs(
        removedSessionKey,
      ),
    ).toBeUndefined();
    expect(state.sessionTransientState.turnMetadata.readModel(removedSessionKey)).toBeUndefined();
    expect(
      listAgentSessions(state.sessionStore.getSessionCollectionSnapshot()).find(
        (session) => session.externalSessionId === "external-1",
      ) ?? null,
    ).toBeNull();
    await harness.unmount();
  });

  test("removes sessions by task and role through the commit boundary", async () => {
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        workspaceRepoPath: "/tmp/repo",
        tasks: [createTaskFixture()],
      });
      const observers = useAgentSessionObservers({
        agentEngine: createNoopEngine(),
        sessionObserversRef: state.sessionObserversRef,
        sessionTransientState: state.sessionTransientState,
        readSessions: state.sessionStore.getSessionsSnapshot,
        readSession: state.sessionStore.getSessionSnapshot,
        setSessionCollection: state.sessionStore.setSessionCollection,
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { state, observers };
    };
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    const buildSession = createSession({
      externalSessionId: "external-build",
      role: "build",
      workingDirectory: "/tmp/repo/build",
    });
    const qaSession = createSession({
      externalSessionId: "external-qa",
      role: "qa",
      workingDirectory: "/tmp/repo/qa",
    });
    await harness.run(({ state }) => {
      state.sessionStore.setSessionCollection(
        createAgentSessionCollection([buildSession, qaSession]),
      );
    });

    await harness.run(({ observers }) =>
      observers.removeAgentSessions({ taskId: "task-1", roles: ["build"] }),
    );

    expect(
      listAgentSessions(harness.getLatest().state.sessionStore.getSessionCollectionSnapshot()),
    ).toEqual([qaSession]);
    await harness.unmount();
  });
});
