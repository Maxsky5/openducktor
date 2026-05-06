import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createNoopEngine, createSession, taskFixture } from "./orchestrator-hook-test-fixtures";
import { useAgentSessionListeners } from "./use-agent-session-listeners";
import { useOrchestratorSessionState } from "./use-orchestrator-session-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentSessionListeners", () => {
  test("removal clears subscriptions, draft refs, timing refs, and session state", async () => {
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
});
