import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { AgentOperationsContext } from "@/state/app-state-contexts";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { host } from "@/state/operations/host";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentOperationsContextValue } from "@/types/state-slices";
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
const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
const replyAgentApprovalRef: {
  current: AgentOperationsContextValue["replyAgentApproval"];
} = { current: async () => undefined };
const answerAgentQuestionRef: {
  current: AgentOperationsContextValue["answerAgentQuestion"];
} = { current: async () => undefined };

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
  replyAgentApproval: replyAgentApprovalRef.current,
  answerAgentQuestion: answerAgentQuestionRef.current,
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

const createLiveApprovalEvent = (): Extract<AgentEvent, { type: "approval_required" }> => ({
  type: "approval_required",
  externalSessionId: "session-1",
  requestId: "approval-live",
  requestType: "permission_grant",
  title: "Approve read",
  summary: "Approval request for read.",
  affectedPaths: ["src/**"],
  action: { name: "read" },
  mutation: "read_only",
  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
  timestamp: "2026-02-22T12:01:00.000Z",
});

const createLiveQuestionEvent = (): Extract<AgentEvent, { type: "question_required" }> => ({
  type: "question_required",
  externalSessionId: "session-1",
  requestId: "question-live",
  questions: [{ header: "Confirm", question: "Continue?", options: [] }],
  timestamp: "2026-02-22T12:01:00.000Z",
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
  beforeEach(() => {
    subscribeSessionEventsRef.current = async () => () => undefined;
    replyAgentApprovalRef.current = async () => undefined;
    answerAgentQuestionRef.current = async () => undefined;
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  afterEach(() => {
    host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
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

  test("replies to transient input through the bound runtime ref and clears resolved controls", async () => {
    host.workspaceGetSettingsSnapshot = async () =>
      createSettingsSnapshotFixture({
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: {
            enabled: true,
            defaults: {
              sandboxMode: "read-only",
              approvalPolicy: "untrusted",
              approvalsReviewer: "user",
              commandNetworkAccess: false,
            },
            roleOverrides: {
              spec: {
                sandboxMode: "workspace-write",
                approvalPolicy: "on-request",
                approvalsReviewer: "auto_review",
                commandNetworkAccess: true,
              },
            },
          },
        },
      });
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "spec" as const };
    let listener: ((event: AgentEvent) => void) | null = null;
    subscribeSessionEventsRef.current = async (_sessionRef, nextListener) => {
      listener = nextListener;
      return () => undefined;
    };
    const replyAgentApproval = mock(async () => undefined);
    const answerAgentQuestion = mock(async () => undefined);
    replyAgentApprovalRef.current = replyAgentApproval;
    answerAgentQuestionRef.current = answerAgentQuestion;
    readSessionHistoryRef.current = async () => [createHistoryMessage()];
    const target = createTarget({ runtimeKind: "codex", sessionScope });
    const harness = createHookHarness(createBaseArgs({ target }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null && listener !== null);
      await harness.run(async () => {
        listener?.(createLiveApprovalEvent());
        listener?.(createLiveQuestionEvent());
      });
      await harness.waitFor(
        (state) =>
          state.interactionSession?.pendingApprovals.length === 1 &&
          state.interactionSession.pendingQuestions.length === 1,
      );

      const approval = harness.getLatest().interactionSession?.pendingApprovals[0];
      const question = harness.getLatest().interactionSession?.pendingQuestions[0];
      if (!approval || !question) {
        throw new Error("Expected transient pending input.");
      }
      await harness.run(async () => {
        await harness.getLatest().replyAgentApproval(target, approval, "approve_once");
        await harness.getLatest().answerAgentQuestion(target, question, [["yes"]]);
      });

      const expectedRef = {
        repoPath: "/repo-a",
        runtimeKind: "codex",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-1",
        sessionScope,
        runtimePolicy: {
          kind: "codex",
          policy: {
            sandboxMode: "workspace-write",
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            approvalsReviewerApplies: true,
            commandNetworkAccess: true,
          },
        },
      };
      expect(replyAgentApproval).toHaveBeenCalledWith(
        expectedRef,
        approval,
        "approve_once",
        undefined,
      );
      expect(answerAgentQuestion).toHaveBeenCalledWith(expectedRef, question, [["yes"]]);
      expect(harness.getLatest().interactionSession?.pendingApprovals).toEqual([]);
      expect(harness.getLatest().interactionSession?.pendingQuestions).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("preserves transcript target workflow scope for Codex runtime policy", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const subscribeSessionEvents = mock(async () => () => undefined);
    host.workspaceGetSettingsSnapshot = mock(async () =>
      createSettingsSnapshotFixture({
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: {
            enabled: true,
            defaults: {
              sandboxMode: "read-only",
              approvalPolicy: "untrusted",
              approvalsReviewer: "user",
              commandNetworkAccess: false,
            },
            roleOverrides: {
              spec: {
                sandboxMode: "workspace-write",
                approvalPolicy: "on-request",
                approvalsReviewer: "auto_review",
                commandNetworkAccess: true,
              },
            },
          },
        },
      }),
    );
    readSessionHistoryRef.current = readSessionHistory;
    subscribeSessionEventsRef.current = subscribeSessionEvents;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "spec" as const };
    const expectedSessionRef: PolicyBoundSessionRef = {
      repoPath: "/repo-a",
      runtimeKind: "codex",
      workingDirectory: "/repo-a/worktree",
      externalSessionId: "session-1",
      sessionScope,
      runtimePolicy: {
        kind: "codex",
        policy: {
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          approvalsReviewerApplies: true,
          commandNetworkAccess: true,
        },
      },
    };
    const harness = createHookHarness(
      createBaseArgs({
        target: createTarget({
          runtimeKind: "codex",
          sessionScope,
        }),
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith(expectedSessionRef);
      expect(subscribeSessionEvents).toHaveBeenCalledWith(expectedSessionRef, expect.any(Function));
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

  test("merges history into an already-live runtime session", async () => {
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
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      await harness.waitFor((state) =>
        state.session ? getSessionMessageCount(state.session) > 0 : false,
      );

      expect(readSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().session).toMatchObject({
        externalSessionId: liveSession.externalSessionId,
        runtimeKind: liveSession.runtimeKind,
        workingDirectory: liveSession.workingDirectory,
      });
      const mergedSession = harness.getLatest().session;
      expect(mergedSession ? getSessionMessageCount(mergedSession) : 0).toBeGreaterThan(0);
      expect(harness.getLatest().transcriptState).toEqual({ kind: "visible" });
    } finally {
      await harness.unmount();
    }
  });

  test("observes child runtime events when a matching projected session already exists", async () => {
    const subscribed: { listener: ((event: AgentEvent) => void) | null } = { listener: null };
    const subscribeSessionEvents = mock(async (_sessionRef: PolicyBoundSessionRef, listener) => {
      subscribed.listener = listener;
      return () => undefined;
    });
    readSessionHistoryRef.current = async () => [];
    subscribeSessionEventsRef.current = subscribeSessionEvents;
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
    });
    const harness = createHookHarness(createBaseArgs({ liveSession }));

    try {
      await harness.mount();
      await harness.waitFor(() => subscribeSessionEvents.mock.calls.length === 1);

      await harness.run(async () => {
        subscribed.listener?.(createLiveUserMessageEvent());
      });
      await harness.waitFor(
        (state) => (state.session ? getSessionMessageCount(state.session) : 0) === 1,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses overlay pending input when rendering over a matching projected session", async () => {
    const subscribed: { listener: ((event: AgentEvent) => void) | null } = { listener: null };
    subscribeSessionEventsRef.current = async (_sessionRef, listener) => {
      subscribed.listener = listener;
      return () => undefined;
    };
    readSessionHistoryRef.current = async () => [];
    const replyAgentApproval = mock(async () => undefined);
    replyAgentApprovalRef.current = replyAgentApproval;
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
    });
    const harness = createHookHarness(createBaseArgs({ liveSession }));

    try {
      await harness.mount();
      await harness.waitFor(() => subscribed.listener !== null);
      await harness.run(async () => subscribed.listener?.(createLiveApprovalEvent()));
      await harness.waitFor((state) => state.interactionSession?.pendingApprovals.length === 1);
      const approval = harness.getLatest().interactionSession?.pendingApprovals[0];
      if (!approval) {
        throw new Error("Expected overlay approval.");
      }
      await harness.run(async () => {
        await harness.getLatest().replyAgentApproval(createTarget(), approval, "approve_once");
      });

      expect(replyAgentApproval).toHaveBeenCalledWith(createTarget(), approval, "approve_once");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the child runtime subscription stable across projected session updates", async () => {
    const unsubscribe = mock(() => undefined);
    const subscribeSessionEvents = mock(async () => unsubscribe);
    readSessionHistoryRef.current = async () => [];
    subscribeSessionEventsRef.current = subscribeSessionEvents;
    const matchingSession = () =>
      createAgentSessionFixture({
        externalSessionId: "session-1",
        status: "running",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
      });
    const harness = createHookHarness(createBaseArgs({ liveSession: matchingSession() }));

    try {
      await harness.mount();
      await harness.waitFor(() => subscribeSessionEvents.mock.calls.length === 1);

      await harness.update(createBaseArgs({ liveSession: matchingSession() }));

      expect(subscribeSessionEvents).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("merges refreshed projected state into the live overlay without dropping streamed data", async () => {
    const subscribed: { listener: ((event: AgentEvent) => void) | null } = { listener: null };
    subscribeSessionEventsRef.current = async (_sessionRef, listener) => {
      subscribed.listener = listener;
      return () => undefined;
    };
    readSessionHistoryRef.current = async () => [];
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      status: "running",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a/worktree",
      selectedModel: null,
    });
    const harness = createHookHarness(createBaseArgs({ liveSession }));

    try {
      await harness.mount();
      await harness.waitFor(() => subscribed.listener !== null);
      await harness.run(async () => subscribed.listener?.(createLiveUserMessageEvent()));
      await harness.waitFor(
        (state) => (state.session ? getSessionMessageCount(state.session) : 0) === 1,
      );

      const selectedModel = { providerId: "openai", modelId: "gpt-5", variant: "high" };
      await harness.update(createBaseArgs({ liveSession: { ...liveSession, selectedModel } }));

      await harness.waitFor((state) => state.interactionSession?.selectedModel?.variant === "high");
      const renderedSession = harness.getLatest().session;
      expect(renderedSession).not.toBeNull();
      if (!renderedSession) {
        throw new Error("Expected the refreshed transcript session.");
      }
      expect(getSessionMessageCount(renderedSession)).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the first hydrated child subscription when operation callbacks refresh", async () => {
    const subscribed: { listener: ((event: AgentEvent) => void) | null } = { listener: null };
    const firstUnsubscribe = mock(() => undefined);
    const firstSubscribe = mock(async (_sessionRef: PolicyBoundSessionRef, listener) => {
      subscribed.listener = listener;
      return firstUnsubscribe;
    });
    const secondSubscribe = mock(async () => () => undefined);
    readSessionHistoryRef.current = async () => [];
    subscribeSessionEventsRef.current = firstSubscribe;
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => firstSubscribe.mock.calls.length === 1);

      subscribeSessionEventsRef.current = secondSubscribe;
      await harness.update(createBaseArgs());

      expect(firstUnsubscribe).not.toHaveBeenCalled();
      expect(secondSubscribe).not.toHaveBeenCalled();

      await harness.run(async () => {
        subscribed.listener?.(createLiveUserMessageEvent());
      });
      await harness.waitFor(
        (state) => (state.session ? getSessionMessageCount(state.session) : 0) === 1,
      );
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
