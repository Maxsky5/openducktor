import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
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
const subscribeSessionEventsRef: {
  current: AgentOperationsContextValue["subscribeSessionEvents"];
} = {
  current: async () => () => undefined,
};

const operationsValue = (): AgentOperationsContextValue => ({
  readSessionHistory: readSessionHistoryRef.current,
  subscribeSessionEvents: subscribeSessionEventsRef.current,
  readSessionTodos: async () => [],
  loadAgentSessionHistory: async () => null,
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

const createTarget = (
  overrides: Partial<AgentSessionTranscriptTarget> = {},
): AgentSessionTranscriptTarget => ({
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

const createLiveUserMessageEvent = (
  overrides: Partial<Extract<AgentEvent, { type: "user_message" }>> = {},
) =>
  ({
    type: "user_message",
    externalSessionId: "session-1",
    messageId: "message-user-live",
    message: "Live follow-up",
    timestamp: "2026-02-22T12:01:00.000Z",
    state: "read",
    parts: [],
    ...overrides,
  }) satisfies Extract<AgentEvent, { type: "user_message" }>;

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isOpen: true,
  repoPath: "/repo-a",
  target: createTarget(),
  repoReadinessState: "ready",
  liveSession: null,
  ...overrides,
});

describe("useRuntimeTranscriptSessionHistory", () => {
  beforeEach(() => {
    subscribeSessionEventsRef.current = async () => () => undefined;
  });

  test("streams runtime events for an unmaterialized read-only transcript session", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const subscribed: {
      sessionRef: PolicyBoundSessionRef | null;
      listener: ((event: AgentEvent) => void) | null;
    } = {
      sessionRef: null,
      listener: null,
    };
    const unsubscribe = mock(() => undefined);
    const subscribeSessionEvents = mock(async (sessionRef: PolicyBoundSessionRef, listener) => {
      subscribed.sessionRef = sessionRef;
      subscribed.listener = listener;
      return unsubscribe;
    });
    readSessionHistoryRef.current = readSessionHistory;
    subscribeSessionEventsRef.current = subscribeSessionEvents;
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(subscribeSessionEvents).toHaveBeenCalledWith(
        {
          repoPath: "/repo-a",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a/worktree",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "opencode" },
        },
        expect.any(Function),
      );
      expect(subscribed.sessionRef).toEqual({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
        runtimePolicy: { kind: "opencode" },
      });

      await harness.run(async () => {
        subscribed.listener?.(createLiveUserMessageEvent());
      });
      await harness.waitFor(
        (state) => (state.session ? getSessionMessageCount(state.session) : 0) === 2,
      );

      expect(harness.getLatest().interactionSession?.externalSessionId).toBe("session-1");
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });

  test("unsubscribes the transient read-only runtime stream on unmount", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const unsubscribe = mock(() => undefined);
    const subscribeSessionEvents = mock(async () => unsubscribe);
    readSessionHistoryRef.current = readSessionHistory;
    subscribeSessionEventsRef.current = subscribeSessionEvents;
    const harness = createHookHarness(createBaseArgs());

    await harness.mount();
    await harness.waitFor(() => subscribeSessionEvents.mock.calls.length === 1);
    await harness.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

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
        runtimePolicy: { kind: "opencode" },
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

  test("keeps the readonly session stable when the target identity object is rebuilt", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    readSessionHistoryRef.current = readSessionHistory;
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);
      const loadedSession = harness.getLatest().session;

      await harness.update(createBaseArgs({ target: createTarget() }));

      expect(readSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().session).toBe(loadedSession);
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
        runtimePolicy: { kind: "opencode" },
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
