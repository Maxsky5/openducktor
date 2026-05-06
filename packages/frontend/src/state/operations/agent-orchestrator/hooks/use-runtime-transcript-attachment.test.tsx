import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createNoopEngine } from "./agent-session-hook-test-fixtures";
import { useRuntimeTranscriptAttachment } from "./use-runtime-transcript-attachment";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createSessionStoreCallbacks = (sessionsRef: {
  current: Record<string, AgentSessionState>;
}) => ({
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => {
    sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
  },
  updateSession: (
    externalSessionId: string,
    updater: (current: AgentSessionState) => AgentSessionState,
  ) => {
    const current = sessionsRef.current[externalSessionId];
    if (!current) {
      return;
    }
    sessionsRef.current = { ...sessionsRef.current, [externalSessionId]: updater(current) };
  },
});

describe("useRuntimeTranscriptAttachment", () => {
  test("hydrates history and cleans up failed attaches", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const unsubscribersRef = { current: new Map<string, () => void>() };
    const attachSessionListener = mock(() => undefined);
    const removeSessionIds = mock((ids: string[]) => {
      for (const id of ids) delete sessionsRef.current[id];
    });
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
        ...createSessionStoreCallbacks(sessionsRef),
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
          ...createSessionStoreCallbacks(failingSessionsRef),
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
});
