import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import { useRuntimeTranscriptSessionHistory } from "./use-runtime-transcript-session-history";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRuntimeTranscriptSessionHistory>[0];

const readSessionHistoryRef: {
  current: AgentOperationsContextValue["readSessionHistory"];
} = {
  current: async () => [],
};

const operationsValue = (): AgentOperationsContextValue => ({
  readSessionHistory: readSessionHistoryRef.current,
  readSessionTodos: async () => [],
  loadAgentSessionHistory: async () => undefined,
  startAgentSession: async () => ({
    externalSessionId: "session-started",
    runtimeKind: "opencode",
    workingDirectory: "/repo-a",
  }),
  sendAgentMessage: async () => undefined,
  stopAgentSession: async () => undefined,
  updateAgentSessionModel: () => undefined,
  replyAgentApproval: async () => undefined,
  answerAgentQuestion: async () => undefined,
});

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>
    <AgentOperationsContext.Provider value={operationsValue()}>
      {children}
    </AgentOperationsContext.Provider>
  </QueryProvider>
);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRuntimeTranscriptSessionHistory, initialProps, { wrapper });

const createTarget = (overrides: Partial<AgentSessionIdentity> = {}): AgentSessionIdentity => ({
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a/worktree",
  ...overrides,
});

const createHistoryMessage = (): AgentSessionHistoryMessage => ({
  messageId: "message-user-1",
  role: "user",
  timestamp: "2026-02-22T12:00:00.000Z",
  text: "Inspect this",
  displayParts: [],
  state: "read",
  parts: [],
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isOpen: true,
  repoPath: "/repo-a",
  target: createTarget(),
  repoReadinessState: "ready",
  liveSession: null,
  ...overrides,
});

describe("useRuntimeTranscriptSessionHistory", () => {
  test("loads history and builds a readonly transcript session", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      });
      const session = harness.getLatest().session;
      expect(session?.externalSessionId).toBe("session-1");
      expect(session?.runtimeKind).toBe("opencode");
      expect(session?.workingDirectory).toBe("/repo-a/worktree");
      expect(session?.activityState).toBeNull();
      expect(session ? getSessionMessageCount(session) : 0).toBeGreaterThan(0);
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });

  test("prefers an already-live runtime session over history loading", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
    });
    const harness = createHookHarness(
      createBaseArgs({
        liveSession,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().session).toEqual(toAgentChatThreadSession(liveSession));
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });

  test("loads history when a same-id live session belongs to another source", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(
      createBaseArgs({
        liveSession: createAgentSessionFixture({
          externalSessionId: "session-1",
          status: "running",
          runtimeKind: "opencode",
          workingDirectory: "/repo-b/worktree",
        }),
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
      });
      expect(harness.getLatest().session?.activityState).toBeNull();
      expect(harness.getLatest().session?.workingDirectory).toBe("/repo-a/worktree");
    } finally {
      await harness.unmount();
    }
  });

  test("waits for runtime readiness before loading history", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(
      createBaseArgs({
        repoReadinessState: "checking",
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest()).toMatchObject({
        session: null,
        transcriptState: { kind: "runtime_waiting" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("stays inactive while the transcript dialog is closed", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(
      createBaseArgs({
        isOpen: false,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest()).toMatchObject({
        session: null,
        transcriptState: { kind: "empty", reason: "inactive" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps transcript unavailable when history needs a workspace repo path", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(
      createBaseArgs({
        repoPath: null,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest()).toMatchObject({
        session: null,
        transcriptState: { kind: "empty", reason: "unavailable" },
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces history load failures", async () => {
    const readSessionHistory = mock(async () => {
      throw new Error("history unavailable");
    });
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.transcriptState.kind === "failed");

      expect(harness.getLatest()).toMatchObject({
        session: null,
        transcriptState: { kind: "failed", message: "history unavailable" },
      });
    } finally {
      await harness.unmount();
    }
  });
});
