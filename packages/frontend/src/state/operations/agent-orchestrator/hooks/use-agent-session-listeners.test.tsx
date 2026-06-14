import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  createAgentSessionCollection,
  getAgentSessionByExternalSessionId,
} from "@/state/agent-session-collection";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  hasSessionListenerForExternalSessionId,
  setSessionListener,
} from "../support/session-listener-registry";
import {
  createNoopEngine,
  createSession,
  createTaskFixture,
} from "./agent-session-hook-test-fixtures";
import { useAgentSessionListeners } from "./use-agent-session-listeners";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentSessionListeners", () => {
  test("subscribes with the runtime session route after reload", async () => {
    const subscribeEvents = mock(async () => () => undefined);
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        activeWorkspace: {
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/tmp/repo",
        },
        tasks: [createTaskFixture()],
      });
      const listeners = useAgentSessionListeners({
        agentEngine: createNoopEngine({
          subscribeEvents,
          listRuntimeDefinitions: () => [],
        }),
        refBridges: state.refBridges,
        sessionsRef: state.refBridges.sessionsRef,
        commitSessions: state.commitSessions,
        updateSession: () => undefined,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
        recordTurnActivityTimestamp: () => undefined,
        recordTurnUserMessageTimestamp: () => undefined,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => undefined,
        refreshTaskData: async () => undefined,
      });
      return { listeners };
    };

    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    const sessionRef = {
      externalSessionId: "external-1",
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    } as const;

    await harness.run(async ({ listeners }) => {
      await listeners.listenToAgentSession(sessionRef);
    });

    expect(subscribeEvents).toHaveBeenCalledWith(sessionRef, expect.any(Function));

    await harness.unmount();
  });

  test("replaces stale listener when the same external id points to another session identity", async () => {
    const firstUnsubscribe = mock(() => undefined);
    const secondUnsubscribe = mock(() => undefined);
    const subscribeEvents = mock(async () =>
      subscribeEvents.mock.calls.length === 1 ? firstUnsubscribe : secondUnsubscribe,
    );
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        activeWorkspace: {
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/tmp/repo",
        },
        tasks: [createTaskFixture()],
      });
      const listeners = useAgentSessionListeners({
        agentEngine: createNoopEngine({
          subscribeEvents,
          listRuntimeDefinitions: () => [],
        }),
        refBridges: state.refBridges,
        sessionsRef: state.refBridges.sessionsRef,
        commitSessions: state.commitSessions,
        updateSession: () => undefined,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
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

    const firstSessionRef = {
      externalSessionId: "external-1",
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/old-worktree",
    } as const;
    const secondSessionRef = {
      ...firstSessionRef,
      workingDirectory: "/tmp/repo/new-worktree",
    };

    await harness.run(async ({ listeners }) => {
      await listeners.listenToAgentSession(firstSessionRef);
      await listeners.listenToAgentSession(secondSessionRef);
    });

    const registry = harness.getLatest().state.refBridges.sessionListenerRegistryRef.current;
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(secondUnsubscribe).not.toHaveBeenCalled();
    expect(subscribeEvents).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(1);
    expect(hasSessionListenerForExternalSessionId(registry, "external-1")).toBe(true);

    await harness.unmount();
  });

  test("removal clears subscriptions, draft refs, timing refs, and session state", async () => {
    const unsubscribe = mock(() => undefined);
    const queryClient = new QueryClient();
    const Harness = () => {
      const state = useOrchestratorSessionState({
        activeWorkspace: {
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/tmp/repo",
        },
        tasks: [createTaskFixture()],
      });
      const listeners = useAgentSessionListeners({
        agentEngine: createNoopEngine(),
        refBridges: state.refBridges,
        sessionsRef: state.refBridges.sessionsRef,
        commitSessions: state.commitSessions,
        updateSession: () => undefined,
        queryClient,
        workspaceId: "workspace",
        loadRepoPromptOverrides: async () => ({}),
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
      state.commitSessions(createAgentSessionCollection([createSession()]));
      setSessionListener(
        state.refBridges.sessionListenerRegistryRef.current,
        {
          externalSessionId: "external-1",
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
        unsubscribe,
      );
      state.refBridges.draftRawBySessionRef.current["external-1"] = { reasoning: "draft" };
      state.refBridges.draftSourceBySessionRef.current["external-1"] = { reasoning: "delta" };
      state.refBridges.draftMessageIdBySessionRef.current["external-1"] = {
        reasoning: "message-1",
      };
      state.refBridges.assistantTurnTimingBySessionRef.current["external-1"] = {
        activityStartedAtMs: 1,
      };
      state.refBridges.turnModelBySessionRef.current["external-1"] = null;
    });
    await harness.run(({ listeners }) => listeners.removeSessionIds(["external-1"]));
    const { state } = harness.getLatest();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      hasSessionListenerForExternalSessionId(
        state.refBridges.sessionListenerRegistryRef.current,
        "external-1",
      ),
    ).toBe(false);
    expect(state.refBridges.draftRawBySessionRef.current["external-1"]).toBeUndefined();
    expect(state.refBridges.assistantTurnTimingBySessionRef.current["external-1"]).toBeUndefined();
    expect(
      getAgentSessionByExternalSessionId(
        state.sessionStore.getSessionCollectionSnapshot(),
        "external-1",
      ),
    ).toBeNull();
    await harness.unmount();
  });
});
