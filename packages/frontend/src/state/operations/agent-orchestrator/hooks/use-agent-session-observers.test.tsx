import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
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
        sessionTurnState: state.sessionTurnState,
        readSession: state.sessionStore.getSessionSnapshot,
        ensureSession: (_identity, createSession) => createSession(),
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        refreshTaskData: async () => undefined,
      });
      return { observers };
    };

    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    const sessionRef = {
      externalSessionId: "external-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "opencode" },
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
        sessionTurnState: state.sessionTurnState,
        readSession: state.sessionStore.getSessionSnapshot,
        ensureSession: (_identity, createSession) => createSession(),
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        refreshTaskData: async () => undefined,
      });
      return { state, observers };
    };

    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    const sessionRef = {
      externalSessionId: "external-1",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimePolicy: { kind: "opencode" },
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

  test("clearSessionObservationState clears subscriptions and turn state without mutating session collection", async () => {
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
        sessionTurnState: state.sessionTurnState,
        readSession: state.sessionStore.getSessionSnapshot,
        ensureSession: (_identity, createSession) => createSession(),
        updateSession: () => null,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        refreshTaskData: async () => undefined,
      });
      return { state, observers };
    };
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run(async ({ state }) => {
      const session = createSession();
      const sessionKey = agentSessionIdentityKey(session);
      state.sessionStore.setSessionCollection(() => createAgentSessionCollection([session]));
      await state.sessionObserversRef.current.ensureObserver(
        {
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
        async () => unsubscribe,
      );
      state.sessionTurnState.timing.recordTurnUserMessageTimestamp(sessionKey, 1);
      state.sessionTurnState.metadata.recordModel(sessionKey, null);
    });
    const removedSession = {
      externalSessionId: "external-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const removedSessionKey = agentSessionIdentityKey(removedSession);
    await harness.run(({ observers }) => observers.clearSessionObservationState([removedSession]));
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
      state.sessionTurnState.timing.readTurnUserMessageStartedAtMs(removedSessionKey),
    ).toBeUndefined();
    expect(state.sessionTurnState.metadata.readModel(removedSessionKey)).toBeUndefined();
    expect(state.sessionStore.getSessionSnapshot(removedSession)).not.toBeNull();
    await harness.unmount();
  });
});
