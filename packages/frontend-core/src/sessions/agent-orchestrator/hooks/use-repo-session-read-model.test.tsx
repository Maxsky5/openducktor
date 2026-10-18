import "../../../test-support/dom-environment";
import { describe, expect, mock, spyOn, test } from "bun:test";
import * as workspaceRecords from "../session-read-model/workspace-session-records";
import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRefreshInput,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveSnapshot,
  AgentSessionRecord,
  AgentMessageSubmitInput,
  AgentMessageSubmitResult,
  AgentQueuedMessageState,
  RepoConfig,
  TaskCompletionObservation,
  WorkspaceSession,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createAgentMessageQueuesStore } from "../../agent-message-queues-store";
import { createAgentSessionCollection } from "../../agent-session-collection";
import { createAgentSessionsStore } from "../../agent-sessions-store";
import { type AgentSessionReadPort, agentSessionQueryKeys } from "../../../queries/agent-sessions";
import { workspaceQueryKeys } from "../../../queries/workspace";
import { workspaceSessionQueryKeys } from "../../../queries/workspace-sessions";
import { createAgentMessageQueueSnapshot } from "../../../test-support/agent-message-send-fixture";
import { createLiveSnapshotEnvelope } from "../../../test-support/agent-session-live-fixture";
import { createHookHarness } from "../../../test-support/react-hook-harness";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "../../../test-support/shared-test-fixtures";
import type { HostConnection } from "../../../connection/host-connection";
import type { ClientFeedback } from "../../../platform/client-feedback";
import { createFeedbackFake } from "../../../test-support/feedback-fake";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../../../test-support/test-client-connection";
import { getAgentSessionActivityStateFromSession } from "../../../lib/agent-session-activity-state";
import { canResumeInterruptedTurn } from "../../../lib/agent-session-interrupted-turn";
import { sessionMessagesToArray } from "../../../test-support/session-message-test-helpers";
import {
  createAgentSessionTranscriptEventConsumer,
  type AgentSessionTranscriptEventConsumer,
} from "../events/session-transcript-events";
import { createSessionTurnState } from "../support/session-turn-state";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { appendSendFailureNotice, createSendAgentMessage } from "../handlers/send-agent-message";
import type { AgentSessionLiveFrontendPort } from "./use-repo-session-read-model";
import { useRepoSessionReadModel } from "./use-repo-session-read-model";

const record: AgentSessionRecord = {
  externalSessionId: "thread-1",
  role: "build",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-07-16T08:00:00.000Z",
  selectedModel: null,
};

const createReadOnlyRepoConfig = (): RepoConfig => ({
  workspaceId: "/repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  promptOverrides: {
    "permission.read_only.reject": {
      template: "Custom read-only rejection for {{role}}.",
      baseVersion: 1,
      enabled: true,
    },
  },
  worktreeCopyPaths: [],
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

type TaskSessionRecordBatch = Array<{
  taskId: string;
  agentSessions: AgentSessionRecord[];
}>;

const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: record.workingDirectory,
    externalSessionId: record.externalSessionId,
  },
  activity: "idle",
  title: "Builder",
  startedAt: record.startedAt,
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const queueTarget = () => ({
  ...snapshot().ref,
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
});

const scopedFault = (ref = snapshot().ref) =>
  ({
    type: "fault",
    repoPath: "/repo",
    message: "The runtime lost this session.",
    ref,
  }) as const satisfies AgentSessionLiveEnvelope;

const createState = (
  duringObservation: (
    emit: (event: AgentSessionLiveEnvelope) => void,
    observeIndex: number,
  ) => void,
  taskRecords: AgentSessionRecord | AgentSessionRecord[] = record,
  sessionReadPort: AgentSessionReadPort = {
    agentSessionsListForTasks: async () => {
      throw new Error("Per-task session cache should already be hydrated.");
    },
  },
  {
    host = createTestHostConnection(),
    feedback = createFeedbackFake(),
  }: { host?: HostConnection; feedback?: ClientFeedback } = {},
) => {
  const queryClient = new QueryClient();
  // Workspace session reads and their update stream find the host through the query client.
  createTestClientConnection({ host, queryClient, feedback });
  const records = Array.isArray(taskRecords) ? taskRecords : [taskRecords];
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), records);
  const sessionStore = createAgentSessionsStore("/repo");
  const messageQueues = createAgentMessageQueuesStore();
  if (records.length === 0) {
    sessionStore.replaceSession(
      createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
        sessionAssociation: { kind: "unbound" },
        status: "idle",
        startedAt: record.startedAt,
      }),
    );
  }
  let listener: ((payload: AgentSessionLiveEnvelope) => void) | null = null;
  const callOrder: string[] = [];
  const unsubscribe = mock(() => undefined);
  const observeAgentSessionLive = mock(
    async (
      _input: AgentSessionLiveRefreshInput,
      nextListener: (payload: AgentSessionLiveEnvelope) => void,
    ) => {
      callOrder.push("observe");
      listener = nextListener;
      duringObservation(nextListener, observeAgentSessionLive.mock.calls.length);
      return unsubscribe;
    },
  );
  const agentSessionLiveReplyApproval = mock(
    async (_input: AgentSessionLiveReplyApprovalInput) => undefined,
  );
  const liveSessionPort: AgentSessionLiveFrontendPort = {
    observeAgentSessionLive,
    agentSessionLiveReplyApproval,
  };
  const transcriptEvents: AgentSessionTranscriptEventConsumer = {
    handle: mock(() => undefined),
    flushSession: mock(() => undefined),
    close: mock(() => undefined),
  };
  const props: Parameters<typeof useRepoSessionReadModel>[0] = {
    workspaceRepoPath: "/repo",
    taskIds: ["task-1"],
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef: { current: "/repo" },
    repoEpochRef: { current: 0 },
    commitSessionCollection: sessionStore.commitSessionCollection,
    applyLiveSessionEnvelope: sessionStore.applyLiveSessionEnvelope,
    recordHistoryEnvelope: sessionStore.recordHistoryEnvelope,
    messageQueues,
    liveSessionPort,
    transcriptEvents,
    queryClient,
    sessionReadPort,
    feedback,
  };

  return {
    callOrder,
    subscribe: sessionStore.subscribe,
    clearSessions: () => sessionStore.setSessionCollection(() => createAgentSessionCollection([])),
    replaceSession: sessionStore.replaceSession,
    getSession: () =>
      sessionStore.getSessionSnapshot({
        externalSessionId: record.externalSessionId,
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      }),
    getStoredSession: (identity: {
      externalSessionId: string;
      runtimeKind: AgentSessionRecord["runtimeKind"];
      workingDirectory: string;
    }) => sessionStore.getSessionSnapshot(identity),
    getSessionActivityStates: () =>
      sessionStore
        .getActivitySnapshot()
        .sessions.map(({ externalSessionId, activityState }) => ({
          externalSessionId,
          activityState,
        }))
        .sort((left, right) => left.externalSessionId.localeCompare(right.externalSessionId)),
    harness: createHookHarness(useRepoSessionReadModel, props),
    props,
    observeAgentSessionLive,
    unsubscribe,
    agentSessionLiveReplyApproval,
    transcriptEvents,
    emit: (payload: AgentSessionLiveEnvelope) => {
      if (!listener) {
        throw new Error("Live-session listener is not ready.");
      }
      listener(payload);
    },
    queryClient,
    feedback,
    updateSession: sessionStore.updateSession,
    messageQueues,
  };
};

const createRepositoryConflictRetryState = (
  agentSessionsListForTasks: AgentSessionReadPort["agentSessionsListForTasks"],
  duringObservation: Parameters<typeof createState>[0] = (emit) => {
    emit(
      createLiveSnapshotEnvelope({
        sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
      }),
    );
  },
) =>
  createState(duringObservation, [], {
    agentSessionsListForTasks,
  });

const createPendingResponseSend = (state: ReturnType<typeof createState>) => {
  const response = createDeferred<AgentMessageSubmitResult>();
  const submitted = createDeferred<AgentMessageSubmitInput>();
  const turn = createSessionTurnState();
  const send = createSendAgentMessage({
    workspaceRepoPath: "/repo",
    repoEpochRef: state.props.repoEpochRef,
    currentWorkspaceRepoPathRef: state.props.currentWorkspaceRepoPathRef,
    readSessionSnapshot: state.getStoredSession,
    updateSession: state.updateSession,
    messageQueues: state.messageQueues,
    turnMetadata: turn.metadata,
    clearSessionTurnState: turn.clearSession,
    recordTurnUserMessageTimestamp: turn.timing.recordTurnUserMessageTimestamp,
    adapter: {
      submitUserMessage: (input) => {
        submitted.resolve(input);
        return response.promise;
      },
    },
    feedback: state.feedback,
  });
  return { response, submitted, send };
};

describe("useRepoSessionReadModel", () => {
  test.each(["codex", "claude", "opencode"] as const)(
    "%s binds a new task session with its running state in one update",
    async (runtimeKind) => {
      const state = createState((emit) => emit(createLiveSnapshotEnvelope({ sessions: [] })), []);
      const saved = { ...record, runtimeKind, externalSessionId: "new-thread" };
      const ref = { ...snapshot().ref, runtimeKind, externalSessionId: saved.externalSessionId };
      const statuses: string[] = [];
      const unsubscribe = state.subscribe(() => {
        const current = state.getStoredSession(ref);
        if (current) statuses.push(current.status);
      });
      try {
        await state.harness.mount();
        await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
        await state.harness.run(() => {
          const liveSession = snapshot({ ref, activity: "running" });
          state.emit({ type: "session_upsert", session: liveSession });
          const ownership = {
            type: "task_session_records_updated" as const,
            repoPath: "/repo",
            taskId: "task-1",
            agentSessions: [saved],
            liveSession,
          };
          state.emit(ownership);
        });
        expect(statuses).toEqual(["running"]);
      } finally {
        unsubscribe();
        await state.harness.unmount();
        state.queryClient.clear();
      }
    },
  );

  test.each(["codex", "claude", "opencode"] as const)(
    "%s applies new task ownership before the first user event in the same stream batch",
    async (runtimeKind) => {
      const state = createState((emit) => emit(createLiveSnapshotEnvelope({ sessions: [] })), []);
      const saved = { ...record, runtimeKind, externalSessionId: "new-thread" };
      const ref = { ...snapshot().ref, runtimeKind, externalSessionId: saved.externalSessionId };
      const consumer = createAgentSessionTranscriptEventConsumer({
        readSession: state.getStoredSession,
        ensureSession: (_identity, createSession) => createSession(),
        updateSession: state.updateSession,
        updateSessionTodos: () => undefined,
        sessionTurnState: createSessionTurnState(),
        feedback: state.feedback,
      });
      state.props.transcriptEvents = consumer;
      try {
        await state.harness.mount();
        await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
        await state.harness.run(() => {
          state.emit({
            type: "task_session_records_updated",
            repoPath: "/repo",
            taskId: "task-1",
            agentSessions: [saved],
          });
          state.emit({ type: "session_upsert", session: snapshot({ ref, activity: "running" }) });
          state.emit({
            type: "transcript_event",
            event: {
              type: "user_message",
              externalSessionId: ref.externalSessionId,
              sessionRef: ref,
              timestamp: "2026-07-16T08:00:01.000Z",
              messageId: "first-user",
              message: "Start this task",
              parts: [{ kind: "text", text: "Start this task" }],
              state: "read",
            },
          });
          state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [saved]);
        });
        const session = state.getStoredSession(ref);
        expect(session?.sessionAssociation).toEqual({
          kind: "workflow",
          taskId: "task-1",
          role: "build",
        });
        expect(session?.status).toBe("running");
        expect(sessionMessagesToArray(session!)).toContainEqual(
          expect.objectContaining({ id: "first-user", role: "user", content: "Start this task" }),
        );
      } finally {
        consumer.close();
        await state.harness.unmount();
        state.queryClient.clear();
      }
    },
  );

  test("replaces repository message queues from snapshots and applies queue updates", async () => {
    const queue = (revision: number, texts: string[]) =>
      createAgentMessageQueueSnapshot({ target: queueTarget(), revision, texts });
    const state = createState((emit) =>
      emit(
        createLiveSnapshotEnvelope({
          sessions: [snapshot()],
          messageQueues: [queue(1, ["First"])],
        }),
      ),
    );
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.messageQueues.getQueue(snapshot().ref)?.revision).toBe(1);

      await state.harness.run(() =>
        state.emit({ type: "message_queue_updated", queue: queue(2, ["First", "Second"]) }),
      );
      expect(state.messageQueues.getQueue(snapshot().ref)?.entries).toHaveLength(2);
    } finally {
      await state.harness.unmount();
    }
  });

  test("reconciles completion alerts with snapshots and preserves unrelated alerts", async () => {
    const suffix = crypto.randomUUID();
    const failed = (taskId: string): TaskCompletionObservation => ({
      repoPath: "/repo",
      taskId,
      phase: "settled",
      confirmedDestinations: [],
      uncertainDestinations: [],
      failure: {
        stage: "cleanup",
        code: "task_completion_failed",
        message: "Worktree removal failed.",
        nextAction: "Inspect the worktree.",
      },
    });
    const removed = failed(`reset-${suffix}`);
    const retained = failed(`pending-${suffix}`);
    const removedId = `task-completion:/repo:${removed.taskId}`;
    const retainedId = `task-completion:/repo:${retained.taskId}`;
    const otherRepoId = `task-completion:/repo/other:${removed.taskId}`;
    const unrelatedId = `unrelated-${suffix}`;
    // Like the app feedback, a message with an ID stays visible until something dismisses that ID.
    const activeMessages = new Map<string, string>();
    const feedback: ClientFeedback = {
      show: (_kind, message, options) => {
        activeMessages.set(options?.id ?? message, message);
      },
      dismiss: (id) => {
        activeMessages.delete(id);
      },
    };
    const activeIds = () => [...activeMessages.keys()];
    const state = createState(
      (emit) =>
        emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot()],
            taskCompletions: [removed, retained],
          }),
        ),
      record,
      undefined,
      { feedback },
    );
    try {
      feedback.show("error", "Another repository needs attention", {
        id: otherRepoId,
        duration: Infinity,
      });
      feedback.show("error", "Unrelated notification", { id: unrelatedId, duration: Infinity });
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(activeIds()).toContain(removedId);
      expect(activeIds()).toContain(retainedId);

      await state.harness.run(() =>
        state.emit(
          createLiveSnapshotEnvelope({ sessions: [snapshot()], taskCompletions: [retained] }),
        ),
      );
      expect(activeIds()).not.toContain(removedId);
      expect(activeIds()).toContain(retainedId);

      await state.harness.run(() =>
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
      );
      expect(activeIds()).not.toContain(retainedId);
      expect(activeIds()).toContain(otherRepoId);
      expect(activeIds()).toContain(unrelatedId);
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test.each([
    { outcome: "not_issued", responseFirst: true },
    { outcome: "not_issued", responseFirst: false },
    { outcome: "refused", responseFirst: true },
    { outcome: "refused", responseFirst: false },
  ] as const)("authoritative refusal clears matching Send uncertainty: %j", async (example) => {
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
    );
    const { response, submitted, send } = createPendingResponseSend(state);
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const session = state.getSession();
      if (!session) throw new Error("Missing session");
      let receipt!: ReturnType<typeof send>;
      await state.harness.run(() => {
        appendSendFailureNotice(session, "An unrelated failure", state.updateSession, false);
        receipt = send(session, [{ kind: "text", text: "Follow up" }]);
      });
      const input = await submitted.promise;
      const refuse = (submissionId: string) =>
        state.emit({
          type: "session_operation_updated",
          observation: {
            ref: snapshot().ref,
            kind: "submission",
            pending: false,
            nativeOutcome: example.outcome,
            submissionId,
            failure: {
              stage: "model",
              code: "invalid_model",
              message: "Select a model.",
              nextAction: "Refresh the catalog.",
            },
          },
        });
      const loseResponse = async () => {
        response.reject(new Error("Connection ended after dispatch"));
        expect((await receipt)?.outcome).toBe("uncertain");
      };
      if (example.responseFirst) await state.harness.run(loseResponse);
      await state.harness.run(() => refuse("different-submission"));
      expect(state.getSession()?.pendingSubmissionId).toBe(input.submissionId);
      if (example.responseFirst)
        expect(sessionMessagesToArray(state.getSession()!)).toContainEqual(
          expect.objectContaining({
            meta: expect.objectContaining({ unresolvedSubmissionId: input.submissionId }),
          }),
        );
      await state.harness.run(() => refuse(input.submissionId));
      if (!example.responseFirst) await state.harness.run(loseResponse);
      expect(state.getSession()?.status).toBe("idle");
      expect(state.getSession()?.pendingSubmissionId).toBeUndefined();
      expect(state.getSession()?.pendingUserMessageStartedAt).toBeUndefined();
      const messages = sessionMessagesToArray(state.getSession()!);
      expect(
        messages.some(
          (message) =>
            message.meta?.kind === "session_notice" &&
            message.meta.reason === "session_error" &&
            message.meta.unresolvedSubmissionId === input.submissionId,
        ),
      ).toBe(false);
      expect(messages).toContainEqual(
        expect.objectContaining({
          id: `host-operation:submission:${input.submissionId}`,
          content: "Select a model. Refresh the catalog.",
        }),
      );
      expect(messages).toContainEqual(expect.objectContaining({ content: "An unrelated failure" }));
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test.each([
    { activity: "idle", acknowledgeFirst: false },
    { activity: "running", acknowledgeFirst: false },
    { activity: "idle", acknowledgeFirst: true },
    { activity: "running", acknowledgeFirst: true },
    { activity: "idle", acknowledgeFirst: false, connectionSnapshot: true },
    { activity: "running", acknowledgeFirst: false, connectionSnapshot: true },
    { activity: "idle", acknowledgeFirst: false, response: "accepted" },
    { activity: "running", acknowledgeFirst: false, response: "accepted" },
    { activity: "idle", acknowledgeFirst: false, response: "acknowledged" },
    { activity: "running", acknowledgeFirst: false, response: "acknowledged" },
  ] as const)("accepted Send snapshot uses current native activity: %j", async (example) => {
    const { activity, acknowledgeFirst } = example;
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
    );
    const { response, submitted, send } = createPendingResponseSend(state);
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const session = state.getSession();
      if (!session) throw new Error("Missing session");
      let receipt!: ReturnType<typeof send>;
      await state.harness.run(() => {
        receipt = send(session, [{ kind: "text", text: "Follow up" }]);
      });
      const input = await submitted.promise;
      await state.harness.run(async () => {
        if ("response" in example) {
          response.resolve(
            example.response === "accepted"
              ? {
                  kind: "accepted",
                  acceptedMessage: {
                    type: "user_message",
                    sessionRef: snapshot().ref,
                    externalSessionId: input.externalSessionId,
                    messageId: "accepted-user",
                    timestamp: "2026-10-14T10:00:00.000Z",
                    message: "Follow up",
                    parts: [{ kind: "text", text: "Follow up" }],
                    state: "read",
                  },
                }
              : {
                  kind: "acknowledged",
                  outcome: "accepted",
                  submissionId: input.submissionId,
                },
          );
          expect((await receipt)?.outcome).toBe(example.response);
        } else {
          response.reject(new Error("Connection ended after dispatch"));
          expect((await receipt)?.outcome).toBe("uncertain");
        }
      });
      expect(state.getSession()?.status).toBe("running");
      if ("response" in example) {
        expect(state.getSession()?.pendingSubmissionId).toBeUndefined();
        expect(state.getSession()?.pendingUserMessageStartedAt).toBeUndefined();
      } else {
        expect(state.getSession()?.pendingSubmissionId).toBe(input.submissionId);
        expect(state.getSession()?.pendingUserMessageStartedAt).toBeDefined();
      }
      const acknowledgement = {
        ref: snapshot().ref,
        submissionId: input.submissionId,
        kind: "message" as const,
        messageId: "accepted-user",
      };
      if (acknowledgeFirst) {
        await state.harness.run(() =>
          state.emit({ type: "submission_acknowledged", acknowledgement }),
        );
        // Acceptance alone cannot use the older idle snapshot to end this turn.
        expect(state.getSession()?.status).toBe("running");
        expect(state.getSession()?.pendingSubmissionId).toBeUndefined();
      }
      await state.harness.run(() =>
        state.emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot({ activity })],
            submissionAcknowledgements: [acknowledgement],
            isConnectionSnapshot: "connectionSnapshot" in example,
          }),
        ),
      );
      expect(state.getSession()).toMatchObject({ status: activity });
      expect(state.getSession()?.pendingSubmissionId).toBeUndefined();
      expect(state.getSession()?.pendingUserMessageStartedAt).toBeUndefined();
      expect(
        sessionMessagesToArray(state.getSession()!).filter((message) => message.role !== "user"),
      ).toEqual([]);
      await state.harness.run(() => {
        state.updateSession(session, (current) =>
          applyLoadedSessionHistory(current, [
            {
              role: "user",
              messageId: "accepted-user",
              timestamp: "2026-10-14T10:00:00.000Z",
              text: "Follow up",
              parts: [],
              displayParts: [],
              state: "read",
            },
            {
              role: "assistant",
              messageId: "completed-answer",
              timestamp: "2026-10-14T10:00:01.000Z",
              text: "Done",
              parts: [],
            },
          ]),
        );
      });
      expect(state.getSession()?.status).toBe(activity);
      expect(
        state.getSession()?.messages.items.filter((message) => message.role === "user"),
      ).toMatchObject([{ id: "accepted-user", content: "Follow up" }]);
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test.each([
    { projection: "delta", responseFirst: true },
    { projection: "snapshot", responseFirst: true },
    { projection: "delta", responseFirst: false },
    { projection: "snapshot", responseFirst: false },
    { projection: "delta", responseFirst: true, activity: "running", entryState: "editing" },
    { projection: "snapshot", responseFirst: true, activity: "running", entryState: "editing" },
  ] as const)("confirmed queue retention settles a lost Send response: %j", async (example) => {
    const { projection, responseFirst } = example;
    const activity = "activity" in example ? example.activity : "idle";
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
    );
    const { response, submitted, send } = createPendingResponseSend(state);
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const session = state.getSession();
      if (!session) throw new Error("Missing session");
      await state.harness.run(() =>
        appendSendFailureNotice(session, "An unrelated failure", state.updateSession, false),
      );
      state.messageQueues.apply(
        createAgentMessageQueueSnapshot({
          target: queueTarget(),
          revision: 1,
          pause: { message: "Resume required" },
        }),
      );
      let receipt!: ReturnType<typeof send>;
      await state.harness.run(() => {
        receipt = send(session, [{ kind: "text", text: "Follow up" }]);
      });
      const input = await submitted.promise;
      const loseResponse = () =>
        state.harness.run(async () => {
          response.reject(new Error("Connection ended after dispatch"));
          expect((await receipt)?.outcome).toBe(responseFirst ? "uncertain" : "queued");
        });
      if (responseFirst) await loseResponse();
      const queue = createAgentMessageQueueSnapshot({
        target: queueTarget(),
        revision: 2,
        texts: ["Follow up"],
        pause: { message: "Resume required" },
      });
      queue.entries[0]!.submissionId = input.submissionId;
      if ("entryState" in example)
        queue.entries[0] = { ...queue.entries[0]!, state: "editing", editId: "edit-1" };
      if (projection === "delta")
        await state.harness.run(() =>
          state.emit({ type: "session_upsert", session: snapshot({ activity }) }),
        );
      await state.harness.run(() =>
        state.emit(
          projection === "delta"
            ? { type: "message_queue_updated", queue }
            : createLiveSnapshotEnvelope({
                sessions: [snapshot({ activity })],
                messageQueues: [queue],
                isConnectionSnapshot: true,
              }),
        ),
      );
      if (!responseFirst) await loseResponse();
      expect(state.getSession()).toMatchObject({ status: activity });
      expect(state.getSession()?.pendingSubmissionId).toBeUndefined();
      expect(state.getSession()?.pendingUserMessageStartedAt).toBeUndefined();
      expect(state.getSession()?.messages.items).toEqual([
        expect.objectContaining({ content: "An unrelated failure" }),
      ]);
      expect(state.messageQueues.getQueue(input)).toEqual(queue);
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test.each([
    { projection: "delta", responseFirst: true },
    { projection: "snapshot", responseFirst: true },
    { projection: "delta", responseFirst: false },
    { projection: "snapshot", responseFirst: false },
  ] as const)(
    "queue evidence cannot settle another target or unresolved delivery: %j",
    async ({ projection, responseFirst }) => {
      const state = createState((emit) =>
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
      );
      const { response, submitted, send } = createPendingResponseSend(state);
      try {
        await state.harness.mount();
        await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
        const session = state.getSession();
        if (!session) throw new Error("Missing session");
        let receipt!: ReturnType<typeof send>;
        await state.harness.run(() => {
          receipt = send(session, [{ kind: "text", text: "Follow up" }]);
        });
        const input = await submitted.promise;
        const loseResponse = () =>
          state.harness.run(async () => {
            response.reject(new Error("Connection ended after dispatch"));
            expect((await receipt)?.outcome).toBe("uncertain");
          });
        if (responseFirst) await loseResponse();
        let revision = 0;
        const project = (queue: ReturnType<typeof createAgentMessageQueueSnapshot>) =>
          state.harness.run(() =>
            state.emit(
              projection === "delta"
                ? { type: "message_queue_updated", queue }
                : createLiveSnapshotEnvelope({
                    sessions: [snapshot()],
                    messageQueues: [queue],
                    isConnectionSnapshot: true,
                  }),
            ),
          );
        for (const mismatch of [
          { repoPath: "/other" },
          { runtimeKind: "claude" as const },
          { workingDirectory: "/other/checkout" },
          { externalSessionId: "other-session" },
          { submissionId: "other-submission" },
        ]) {
          const queue = createAgentMessageQueueSnapshot({
            target: "submissionId" in mismatch ? queueTarget() : { ...queueTarget(), ...mismatch },
            revision: ++revision,
            texts: ["Follow up"],
          });
          queue.entries[0]!.submissionId =
            "submissionId" in mismatch ? mismatch.submissionId : input.submissionId;
          await project(queue);
          expect(state.getSession()).toMatchObject({
            status: "running",
            pendingSubmissionId: input.submissionId,
          });
        }
        for (const entryState of [
          "sending",
          "steering",
          "acceptance_unknown",
        ] satisfies AgentQueuedMessageState[]) {
          const queue = createAgentMessageQueueSnapshot({
            target: queueTarget(),
            revision: ++revision,
            texts: ["Follow up"],
          });
          queue.entries[0] = {
            ...queue.entries[0]!,
            submissionId: input.submissionId,
            state: entryState,
          };
          await project(queue);
          expect(state.getSession()).toMatchObject({
            status: "running",
            pendingSubmissionId: input.submissionId,
          });
          if (responseFirst)
            expect(state.getSession()?.messages.items).toEqual([
              expect.objectContaining({
                content: expect.stringContaining("delivery remains uncertain"),
              }),
            ]);
          expect(state.messageQueues.getQueue(input)).toEqual(queue);
        }
        if (projection === "delta") {
          const stale = createAgentMessageQueueSnapshot({
            target: queueTarget(),
            revision: 0,
            texts: ["Follow up"],
          });
          stale.entries[0]!.submissionId = input.submissionId;
          await project(stale);
          expect(state.getSession()?.pendingSubmissionId).toBe(input.submissionId);
          expect(state.messageQueues.getQueue(input)?.entries[0]?.state).toBe("acceptance_unknown");
        }
        if (!responseFirst) await loseResponse();
        expect(state.getSession()?.pendingSubmissionId).toBe(input.submissionId);
        expect(state.getSession()?.messages.items).toEqual([
          expect.objectContaining({
            content: expect.stringContaining("delivery remains uncertain"),
          }),
        ]);
      } finally {
        await state.harness.unmount();
        state.queryClient.clear();
      }
    },
  );

  test("removes a pending queue entry in the step that adds its accepted message", async () => {
    const target = queueTarget();
    const queue = createAgentMessageQueueSnapshot({ target, revision: 3, texts: ["first"] });
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()], messageQueues: [queue] })),
    );
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const steps: string[] = [];
      const unsubscribe = state.messageQueues.subscribe(() => steps.push("queue"));
      const handle = state.transcriptEvents.handle;
      state.transcriptEvents.handle = (event) => {
        steps.push("transcript");
        handle(event);
      };

      state.emit({
        type: "transcript_event",
        event: {
          type: "user_message",
          externalSessionId: target.externalSessionId,
          timestamp: "2026-10-08T10:01:00.000Z",
          sessionRef: snapshot().ref,
          messageId: "native-first",
          message: "First",
          parts: [{ kind: "text", text: "First" }],
          state: "read",
          submissionId: "submission-first",
        },
      });
      unsubscribe();

      // Both stores change in one synchronous step, so React renders them together.
      expect(steps).toEqual(["transcript", "queue"]);
      expect(state.messageQueues.getQueue(snapshot().ref)).toBeNull();
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps current history through metadata snapshots and marks it stale on reconnect or stream failure", async () => {
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] })),
    );
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.updateSession(record, (current) => ({ ...current, historyLoadState: "loaded" }));
      });
      const messages = state.getSession()?.messages;
      await state.harness.run(() =>
        state.emit(
          createLiveSnapshotEnvelope({ sessions: [snapshot({ title: "Updated title" })] }),
        ),
      );
      expect(state.getSession()?.historyLoadState).toBe("loaded");
      await state.harness.run(() =>
        state.emit(
          createLiveSnapshotEnvelope({ sessions: [snapshot()], isConnectionSnapshot: true }),
        ),
      );
      expect(state.getSession()?.historyLoadState).toBe("stale");
      expect(state.getSession()?.messages).toBe(messages);
      await state.harness.run(() => {
        state.updateSession(record, (current) => ({ ...current, historyLoadState: "loaded" }));
      });
      await state.harness.run(() =>
        state.emit({ type: "fault", repoPath: "/repo", message: "Disconnected" }),
      );
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("failed");
      expect(state.getSession()?.historyLoadState).toBe("stale");
      expect(state.getSession()?.messages).toBe(messages);
    } finally {
      await state.harness.unmount();
    }
  });
  test.each(["snapshot", "session_upsert"] as const)(
    "publishes policy feedback and session fields together for %s",
    async (type) => {
      const initial = snapshot({
        ref: { ...snapshot().ref, runtimeKind: "claude" },
        title: "Old title",
      });
      const state = createState(
        (emit) => emit(createLiveSnapshotEnvelope({ sessions: [initial] })),
        { ...record, runtimeKind: "claude" },
      );
      const observed: Array<{
        title: string | undefined;
        status: string | undefined;
        messages: string[];
      }> = [];
      let unsubscribe = () => {};
      try {
        await state.harness.mount();
        await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
        unsubscribe = state.subscribe(() => {
          const session = state.getStoredSession(initial.ref);
          observed.push({
            title: session?.title,
            status: session?.status,
            messages: session
              ? sessionMessagesToArray(session).map((message) => message.content)
              : [],
          });
        });
        const updated = {
          ...initial,
          title: "New title",
          activity: "running" as const,
          policyNotice: {
            messageId: "claude-permission-mode:thread-1",
            timestamp: "2026-10-03T10:00:00Z",
            message:
              "Claude permission mode 'auto' was requested, but Claude reports 'default'. Check your Claude permission settings.",
          },
        };
        state.emit(
          type === "snapshot"
            ? createLiveSnapshotEnvelope({ sessions: [updated] })
            : { type, session: updated },
        );
        expect(observed).toEqual([
          { title: "New title", status: "running", messages: [updated.policyNotice.message] },
        ]);
      } finally {
        unsubscribe();
        await state.harness.unmount();
        state.queryClient.clear();
      }
    },
  );

  test("keeps a mismatch warning through workflow registration and clears it on recovery", async () => {
    const state = createState((emit) => emit(createLiveSnapshotEnvelope({ sessions: [] })), []);
    const ref = { ...snapshot().ref, runtimeKind: "claude" as const };
    const session = createAgentSessionFixture({
      ...ref,
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      status: "starting",
    });
    const policyNotice = {
      messageId: "claude-permission-mode:thread-1",
      timestamp: "2026-10-03T10:00:00Z",
      message:
        "Claude permission mode 'auto' was requested, but Claude reports 'default'. Check your Claude permission settings.",
    };
    const liveSession = { ...snapshot({ ref, activity: "running" }), policyNotice };
    const consumer = createAgentSessionTranscriptEventConsumer({
      readSession: state.getStoredSession,
      ensureSession: (_identity, createSession) => createSession(),
      updateSession: state.updateSession,
      updateSessionTodos: () => undefined,
      sessionTurnState: createSessionTurnState(),
      feedback: state.feedback,
    });
    state.props.transcriptEvents = consumer;
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      state.emit({ type: "session_upsert", session: liveSession });
      state.emit({
        type: "transcript_event",
        event: {
          ...policyNotice,
          type: "session_policy_notice",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
        },
      });
      expect(state.getStoredSession(ref)).toBeNull();
      state.replaceSession(session);
      // The launch can replace a record-hydrated session again before attachment finishes.
      state.replaceSession(session);
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([
        expect.objectContaining({
          id: policyNotice.messageId,
          role: "system",
          content: policyNotice.message,
          meta: expect.objectContaining({ reason: "runtime_policy", tone: "warning" }),
        }),
      ]);
      expect(state.getStoredSession(ref)?.status).toBe("starting");
      const reported = {
        ...policyNotice,
        timestamp: "2026-10-03T10:00:01Z",
        message:
          "Claude permission mode 'auto' was requested, but Claude reports 'acceptEdits'. Check your Claude permission settings.",
      };
      state.emit({ type: "session_upsert", session: { ...liveSession, policyNotice: reported } });
      state.replaceSession(session);
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([
        expect.objectContaining({ id: reported.messageId, content: reported.message }),
      ]);
      state.emit({ type: "session_upsert", session: snapshot({ ref, activity: "running" }) });
      state.emit({
        type: "transcript_event",
        event: {
          type: "transcript_retracted",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
          timestamp: "2026-10-03T10:00:02Z",
          messageIds: [reported.messageId],
        },
      });
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([]);
      state.replaceSession(session);
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([]);
      state.emit({ type: "session_upsert", session: { ...liveSession, policyNotice: reported } });
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([
        expect.objectContaining({ id: reported.messageId }),
      ]);
      state.emit(
        createLiveSnapshotEnvelope({ sessions: [{ ...liveSession, policyNotice: reported }] }),
      );
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([
        expect.objectContaining({ id: reported.messageId, content: reported.message }),
      ]);
      // A reconnect can receive the cleared snapshot without the recovery event.
      state.emit(
        createLiveSnapshotEnvelope({ sessions: [snapshot({ ref, activity: "running" })] }),
      );
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([]);
      state.replaceSession(session);
      expect(sessionMessagesToArray(state.getStoredSession(ref)!)).toEqual([]);
    } finally {
      consumer.close();
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test.each([false, true])(
    "chat record failure does not block task observation, cached=%s",
    async (cached) => {
      let fail = true;
      const host = createTestHostConnection({
        client: {
          workspaceSessionListActive: async () => {
            if (fail) throw new Error("Chat records unavailable");
            return [];
          },
        },
        subscribeWorkspaceSessionUpdates: async () => () => {},
      });
      const state = createState(
        (emit) =>
          emit(createLiveSnapshotEnvelope({ sessions: [snapshot({ activity: "running" })] })),
        record,
        {
          agentSessionsListForTasks: async () => [{ taskId: "task-1", agentSessions: [record] }],
        },
        { host },
      );
      state.props.workspaceId = "workspace-A";
      const key = workspaceSessionQueryKeys.list("workspace-A", false);
      if (cached) state.queryClient.setQueryData(key, []);
      try {
        await state.harness.mount();
        if (cached) {
          await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
          await state.harness.run(() => state.queryClient.invalidateQueries({ queryKey: key }));
        }
        await state.harness.waitFor((value) => value.workspaceSessionRecordsError !== null);
        expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
        expect(state.getSession()?.status).toBe("running");
        expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
        fail = false;
        await state.harness.run((value) => value.reloadSessionReadModel());
        await state.harness.waitFor(
          (value) =>
            value.workspaceSessionRecordsError === null &&
            value.sessionReadModelLoadState.kind === "ready",
        );
        expect(state.getSession()?.status).toBe("running");
        expect(
          state.observeAgentSessionLive.mock.calls.length - state.unsubscribe.mock.calls.length,
        ).toBe(1);
      } finally {
        await state.harness.unmount();
        state.queryClient.clear();
      }
    },
  );
  test("commits activity and child input before the transcript consumer runs", async () => {
    const root = snapshot();
    const child = snapshot({
      ref: { ...root.ref, externalSessionId: "child" },
      parentExternalSessionId: root.ref.externalSessionId,
      activity: "waiting_for_question",
      pendingQuestions: [{ requestId: "question", questions: [] }],
    });
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [root, child] })),
    );
    const observed: Array<{ status: string | undefined; questions: number | undefined }> = [];
    state.props.transcriptEvents = {
      close: () => {},
      flushSession: () => {},
      handle: (event) => {
        observed.push({
          status: state.getStoredSession(event.sessionRef)?.status,
          questions: state.getSession()?.pendingQuestions.length,
        });
      },
    };
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.pendingQuestions).toHaveLength(1);
      await state.harness.run(() => {
        state.emit({
          type: "transcript_event",
          event: {
            type: "assistant_delta",
            channel: "text",
            messageId: "message",
            delta: "Text",
            timestamp: "2026-09-12T10:00:00Z",
            externalSessionId: root.ref.externalSessionId,
            sessionRef: root.ref,
          },
        });
        state.emit({
          type: "transcript_event",
          event: {
            type: "session_finished",
            message: "Finished",
            timestamp: "2026-09-12T10:00:01Z",
            externalSessionId: "child",
            sessionRef: child.ref,
          },
        });
        state.emit({
          type: "transcript_event",
          event: {
            type: "session_finished",
            message: "Finished",
            timestamp: "2026-09-12T10:00:02Z",
            externalSessionId: root.ref.externalSessionId,
            sessionRef: root.ref,
          },
        });
      });
      expect(observed).toEqual([
        { status: "running", questions: 1 },
        { status: "idle", questions: 0 },
        { status: "idle", questions: 0 },
      ]);
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });
  test("a settling session snapshot applies the queued final assistant message first", async () => {
    const state = createState((emit) =>
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot({ activity: "running" })] })),
    );
    const transcriptEvents = createAgentSessionTranscriptEventConsumer(
      {
        readSession: (identity) => state.getStoredSession(identity),
        ensureSession: (identity, createSession) => {
          const current = state.getStoredSession(identity);
          if (current) {
            return current;
          }
          const nextSession = createSession();
          state.replaceSession(nextSession);
          return nextSession;
        },
        updateSession: state.updateSession,
        updateSessionTodos: () => undefined,
        sessionTurnState: createSessionTurnState(),
        feedback: state.feedback,
      },
      { batchWindowMs: 60_000 },
    );
    state.props.transcriptEvents = transcriptEvents;
    const ref = snapshot().ref;
    const resumeCardVisible = (): boolean =>
      canResumeInterruptedTurn({
        activityState: getAgentSessionActivityStateFromSession(state.getSession()!),
        messages: sessionMessagesToArray(state.getSession()!),
        runtimeDescriptor: CODEX_RUNTIME_DESCRIPTOR,
      });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      state.emit({
        type: "transcript_event",
        event: {
          type: "user_message",
          messageId: "user-1",
          message: "Do the thing",
          parts: [{ kind: "text", text: "Do the thing" }],
          state: "read",
          timestamp: "2026-07-16T08:00:01.000Z",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
        },
      });
      state.emit({
        type: "transcript_event",
        event: {
          type: "assistant_part",
          part: {
            kind: "text",
            partId: "part-1",
            messageId: "assistant-1",
            text: "Partial answer",
            completed: false,
            synthetic: false,
          },
          timestamp: "2026-07-16T08:00:02.000Z",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
        },
      });
      state.emit({
        type: "transcript_event",
        event: {
          type: "assistant_message",
          messageId: "assistant-1",
          message: "Final answer",
          timestamp: "2026-07-16T08:00:03.000Z",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
        },
      });
      expect(sessionMessagesToArray(state.getSession()!).at(-1)?.content).toBe("Do the thing");

      state.emit({ type: "session_upsert", session: snapshot({ activity: "idle" }) });

      expect(sessionMessagesToArray(state.getSession()!).at(-1)).toMatchObject({
        content: "Final answer",
        meta: { kind: "assistant", isFinal: true },
      });
      expect(resumeCardVisible()).toBe(false);
    } finally {
      transcriptEvents.close();
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test("keeps text updates out of approval and target scans with 200 mixed sessions", async () => {
    const workflowRecords = Array.from({ length: 100 }, (_, index) => ({
      ...record,
      externalSessionId: `task-${index}`,
    }));
    const entries: WorkspaceSession[] = Array.from({ length: 100 }, (_, index) => ({
      id: `workspace-${index}`,
      runtimeKind: "codex",
      externalSessionId: `workspace-${index}`,
      executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    }));
    const sessions = [
      ...workflowRecords.map((entry) =>
        snapshot({
          ref: { ...snapshot().ref, externalSessionId: entry.externalSessionId },
          activity: "running",
        }),
      ),
      ...entries.map((entry) =>
        snapshot({
          ref: { ...snapshot().ref, workingDirectory: "/repo", externalSessionId: entry.id },
          activity: "running",
          repositoryScope: { kind: "repository" },
        }),
      ),
    ];
    const host = createTestHostConnection({
      client: { workspaceSessionListActive: async () => entries },
      subscribeWorkspaceSessionUpdates: async () => () => {},
    });
    const state = createState(
      (emit) => emit(createLiveSnapshotEnvelope({ sessions })),
      workflowRecords,
      undefined,
      { host },
    );
    state.props.workspaceId = "workspace-A";
    const targets = spyOn(workspaceRecords, "reconcileWorkspaceSessionTargetFaults");
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(targets).toHaveBeenCalled();
      targets.mockClear();
      await state.harness.run(() => {
        for (let index = 0; index < 10; index += 1)
          state.emit({
            type: "transcript_event",
            event: {
              type: "assistant_delta",
              channel: "text",
              externalSessionId: "workspace-0",
              messageId: "message",
              delta: `Text ${index}`,
              timestamp: "2026-09-12T10:00:00Z",
              sessionRef: {
                repoPath: "/repo",
                runtimeKind: "codex",
                workingDirectory: "/repo",
                externalSessionId: "workspace-0",
              },
            },
          });
      });
      expect(state.transcriptEvents.handle).toHaveBeenCalledTimes(10);
      expect(targets).not.toHaveBeenCalled();
    } finally {
      targets.mockRestore();
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });
  test("waits for workspace ownership before admitting an unbound native root on cold load", async () => {
    const loaded = createDeferred<WorkspaceSession[]>();
    const entry: WorkspaceSession = {
      id: "workspace-session",
      runtimeKind: record.runtimeKind,
      externalSessionId: record.externalSessionId,
      executionTarget: { kind: "local_repo_root", workingDirectory: record.workingDirectory },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    };
    const native = snapshot({
      activity: "waiting_for_question",
      pendingQuestions: [{ requestId: "answer", questions: [] }],
    });
    const host = createTestHostConnection({
      client: { workspaceSessionListActive: () => loaded.promise },
      subscribeWorkspaceSessionUpdates: async () => () => {},
    });
    const state = createState(
      (emit) => emit(createLiveSnapshotEnvelope({ sessions: [native] })),
      [],
      undefined,
      { host },
    );
    state.props.workspaceId = "workspace-A";
    // A cold store has no task record and no earlier native projection.
    state.clearSessions();
    try {
      await state.harness.mount();
      expect(state.observeAgentSessionLive).not.toHaveBeenCalled();
      await state.harness.run(() => loaded.resolve([entry]));
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).toMatchObject({
        sessionAssociation: { kind: "repository" },
        status: "idle",
        pendingQuestions: [{ requestId: "answer", questions: [] }],
      });
      await state.harness.run(() =>
        state.emit(createLiveSnapshotEnvelope({ sessions: [native], isConnectionSnapshot: true })),
      );
      expect(state.getSession()?.pendingQuestions).toHaveLength(1);
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });
  test("keeps target faults through transcript events and clears them after a valid snapshot", async () => {
    const entry: WorkspaceSession = {
      id: "workspace-session",
      runtimeKind: record.runtimeKind,
      externalSessionId: record.externalSessionId,
      executionTarget: { kind: "local_repo_root", workingDirectory: record.workingDirectory },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    };
    const correct = snapshot({ repositoryScope: { kind: "repository" } });
    const wrong = { ...correct, ref: { ...correct.ref, workingDirectory: "/wrong" } };
    const host = createTestHostConnection({
      client: { workspaceSessionListActive: async () => [entry] },
      subscribeWorkspaceSessionUpdates: async () => () => {},
    });
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [wrong] }));
      },
      [],
      undefined,
      { host },
    );
    state.props.workspaceId = "workspace-A";
    try {
      await state.harness.mount();
      await state.harness.waitFor(
        (value) => value.getSessionFault(correct.ref)?.source === "workspace-target",
      );
      await state.harness.run(() => {
        state.emit({
          type: "transcript_event",
          event: {
            type: "assistant_message",
            externalSessionId: record.externalSessionId,
            messageId: "message",
            message: "An unrelated transcript update.",
            timestamp: "2026-09-07T00:00:00Z",
            sessionRef: correct.ref,
          },
        });
      });
      expect(state.harness.getLatest().getSessionFault(correct.ref)?.source).toBe(
        "workspace-target",
      );
      await state.harness.run(() =>
        state.emit(createLiveSnapshotEnvelope({ sessions: [{ ...correct, activity: "running" }] })),
      );
      expect(state.harness.getLatest().getSessionFault(correct.ref)).toBeNull();
      expect(state.getStoredSession(correct.ref)?.status).toBe("running");
    } finally {
      await state.harness.unmount();
      state.queryClient.clear();
    }
  });

  test("observes the repository and commits snapshot plus ordered creation once", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      emit({
        type: "session_upsert",
        session: snapshot({
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.callOrder).toEqual(["observe"]);
      expect(state.getSession()?.pendingApprovals).toEqual([
        expect.objectContaining({ requestId: "opaque-1" }),
      ]);
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.observeAgentSessionLive).toHaveBeenCalledWith(
        { repoPath: "/repo" },
        expect.any(Function),
      );
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a live workflow session across a later task-record refresh", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      // The durable record list changes while the runtime still reports thread-1.
      // A new historical record proves the refresh actually applied.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed-in" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const refreshedIdentity = {
        externalSessionId: "thread-refreshed-in",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      expect(state.getStoredSession(refreshedIdentity)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("matches a runtime root after another client refreshes its task record", async () => {
    const remoteRecord = { ...record, externalSessionId: "thread-from-other-client" };
    const remoteSnapshot = snapshot({
      ref: { ...snapshot().ref, externalSessionId: remoteRecord.externalSessionId },
      activity: "running",
    });
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [remoteSnapshot] }));
    }, []);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getStoredSession(remoteSnapshot.ref)).toBeNull();
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [
          remoteRecord,
        ]);
        state.emit(createLiveSnapshotEnvelope({ sessions: [remoteSnapshot] }));
      });

      await state.harness.waitFor(
        () => state.getStoredSession(remoteSnapshot.ref)?.livePresence === "present",
      );
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.getStoredSession(remoteSnapshot.ref)?.status).toBe("running");
      expect(state.getStoredSession(remoteSnapshot.ref)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("preserves a fresher selected model across live snapshots", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const selectedModel = {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5.2",
    } as const;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        const updated = state.updateSession(snapshot().ref, (current) => ({
          ...current,
          selectedModel,
        }));
        if (!updated) {
          throw new Error("Expected the selected model to change.");
        }
      });
      expect(state.getSession()?.selectedModel).toEqual(selectedModel);

      await state.harness.run(() => {
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });

      expect(state.getSession()?.selectedModel).toEqual(selectedModel);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a live workflow session when records refresh during an observer restart gap", async () => {
    const releaseRestartSnapshot = createDeferred<void>();
    const state = createState((emit, observeIndex) => {
      if (observeIndex === 1) {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
        return;
      }
      // The restarted observer delays its authoritative snapshot.
      void releaseRestartSnapshot.promise.then(() => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      await state.harness.run(() => {
        state.harness.getLatest().reloadSessionReadModel();
      });
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 2);

      // Task records refresh while the restarted observer waits for its snapshot.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed-in-gap" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const refreshedIdentity = {
        externalSessionId: "thread-refreshed-in-gap",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      releaseRestartSnapshot.resolve();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();
    } finally {
      await state.harness.unmount();
      releaseRestartSnapshot.resolve();
    }
  });

  test("finishes deletion when the runtime removes a session whose record already disappeared", async () => {
    const historical = { ...record, externalSessionId: "hist-thread", role: "planner" as const };
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [record, historical],
    );
    const historicalIdentity = {
      externalSessionId: historical.externalSessionId,
      runtimeKind: historical.runtimeKind,
      workingDirectory: historical.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();

      // A loaded task refresh empties the durable list: the historical row is
      // pruned immediately (proof the refresh applied) while the live session stays.
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
      });
      await state.harness.waitFor(() => state.getStoredSession(historicalIdentity) === null);
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.livePresence).toBe("present");

      // The runtime withdraws live evidence; no further query update is needed.
      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      await state.harness.waitFor(() => state.getSession() === null);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a removed live session while the switched task set is still hydrating", async () => {
    const task2Hydration = createDeferred<TaskSessionRecordBatch>();
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [],
      {
        agentSessionsListForTasks: () => task2Hydration.promise,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.livePresence).toBe("present");

      // Same-repo task-set change while task 2 hydration is still pending.
      const threadTwo = { ...record, externalSessionId: "thread-two", role: "qa" as const };
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });

      // The runtime withdraws the live session before any current-scope read
      // has succeeded; the stale task-1 records must not become deletion proof.
      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.livePresence).toBe("absent");

      // Task 2 finishes hydrating; its owner set cannot prove anything about
      // the task-1 session either.
      await state.harness.run(async () => {
        task2Hydration.resolve([{ taskId: "task-2", agentSessions: [threadTwo] }]);
        await task2Hydration.promise;
      });
      const threadTwoIdentity = {
        externalSessionId: threadTwo.externalSessionId,
        runtimeKind: threadTwo.runtimeKind,
        workingDirectory: threadTwo.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(threadTwoIdentity) !== null);
      expect(state.getStoredSession(threadTwoIdentity)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-2",
        role: "qa",
      });
      expect(state.getSession()).not.toBeNull();
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers the read model when a successful task set follows a failed one", async () => {
    const batchList = mock(async () => [
      {
        taskId: "task-3",
        agentSessions: [{ ...record, externalSessionId: "thread-three", role: "qa" as const }],
      },
    ]);
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [],
      {
        agentSessionsListForTasks: batchList,
      },
    );
    const threadThreeIdentity = {
      externalSessionId: "thread-three",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // Task 2's durable read fails for its exact list query.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Task 3 loads successfully on the same live observation; its collection
      // applies and the stale task-2 failure no longer describes this scope.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      await state.harness.waitFor(() => state.getStoredSession(threadThreeIdentity) !== null);
      const threadThree = state.getStoredSession(threadThreeIdentity);
      if (!threadThree) {
        throw new Error("Expected task-3 historical session.");
      }
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(threadThree.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-3",
        role: "qa",
      });
      expect(state.getSession()).not.toBeNull();
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-3"]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps an unresolved repository fault failed across a successful record refresh", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const refreshedIdentity = {
      externalSessionId: "thread-refreshed",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A healthy durable-record refresh applies, proves it applied by
      // materializing its session, and still cannot clear the live fault.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the observation failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");
    } finally {
      await state.harness.unmount();
    }
  });

  test("shows loading while a hydrating task set supersedes a stale failure", async () => {
    const deferredB = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => deferredB.promise);
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [],
      {
        agentSessionsListForTasks: batchList,
      },
    );
    const threadThree = { ...record, externalSessionId: "thread-three", role: "qa" as const };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // Task 2's durable read fails for its exact list query.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Switching to task 3 demotes the stale failure to loading, and a live
      // snapshot mid-hydration must not bring the old failure back.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "loading");
      await state.harness.run(() => {
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("loading");

      deferredB.resolve([{ taskId: "task-3", agentSessions: [threadThree] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(
        state.getStoredSession({
          externalSessionId: threadThree.externalSessionId,
          runtimeKind: threadThree.runtimeKind,
          workingDirectory: threadThree.workingDirectory,
        }),
      ).not.toBeNull();
    } finally {
      await state.harness.unmount();
      deferredB.resolve([]);
    }
  });

  test("keeps a live-stream failure failed across record recovery until the stream recovers", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // The live stream breaks.
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A task-record read failure then overwrites the public slot.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("record read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("record read failed");
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("record read failed"),
      );

      // The record read recovers; the live-stream failure must surface again.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-after-recovery" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const recoveredIdentity = {
        externalSessionId: "thread-after-recovery",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(recoveredIdentity) !== null);

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the live-stream failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");

      // A fresh authoritative snapshot proves the stream is healthy again.
      await state.harness.run(() => {
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears a public live failure when the stream recovers during task hydration", async () => {
    const deferredRecords = createDeferred<TaskSessionRecordBatch>();
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [],
      {
        agentSessionsListForTasks: mock(() => deferredRecords.promise),
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.source === "live-stream",
      );

      await state.harness.run(() => {
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "loading");

      deferredRecords.resolve([{ taskId: "task-2", agentSessions: [] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
      deferredRecords.resolve([]);
    }
  });

  test("waits for the initial live snapshot after task-record recovery", async () => {
    const state = createState(() => undefined);
    const recoveredRecord = { ...record, externalSessionId: "thread-after-recovery" };
    const recoveredIdentity = {
      externalSessionId: recoveredRecord.externalSessionId,
      runtimeKind: recoveredRecord.runtimeKind,
      workingDirectory: recoveredRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 1);
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("record read failed before snapshot");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("record read failed before snapshot");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [
          recoveredRecord,
        ]);
      });
      await state.harness.waitFor(() => state.getStoredSession(recoveredIdentity) !== null);

      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("loading");

      await state.harness.run(() => {
        state.emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("resurfaces an unresolved live failure after a hydrating task set supersedes a stale one", async () => {
    const deferredB = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => deferredB.promise);
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [],
      {
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // The live stream breaks.
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A task-record read failure then overwrites the public slot.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Switching task sets demotes the stale failure to loading; when the
      // new scope loads, the still-unresolved live failure must surface again.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      deferredB.resolve([
        {
          taskId: "task-3",
          agentSessions: [{ ...record, externalSessionId: "thread-three", role: "qa" as const }],
        },
      ]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the live-stream failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");
    } finally {
      await state.harness.unmount();
      deferredB.resolve([]);
    }
  });

  test("permits historical pruning after the runtime removes a live session", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();

      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      expect(state.getSession()).not.toBeNull();

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
      });
      await state.harness.waitFor(() => state.getSession() === null);
    } finally {
      await state.harness.unmount();
    }
  });

  test("projects repository association into session state", async () => {
    const state = createState((emit) => {
      emit(
        createLiveSnapshotEnvelope({
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        }),
      );
    }, []);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the current collection and reports a task-refresh association conflict", async () => {
    const state = createState((emit) => {
      emit(
        createLiveSnapshotEnvelope({
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        }),
      );
    }, []);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to reconcile task session records for repo '/repo': Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
        source: "task-records",
      });

      await state.harness.run(() => {
        state.emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
          }),
        );
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("failed");
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps an unchanged association conflict failed after retry", async () => {
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [record] }]);
    const state = createState(
      (emit) => {
        emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
          }),
        );
      },
      [],
      {
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to reconcile task session records for repo '/repo': Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
        source: "task-records",
      });
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers an association conflict after retry reads corrected task records", async () => {
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const state = createState(
      (emit) => {
        emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
          }),
        );
      },
      [],
      {
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps forced record retry mode after a transient retry failure", async () => {
    const batchList = mock(async () => {
      if (batchList.mock.calls.length === 1) {
        throw new Error("forced retry failed");
      }
      return [{ taskId: "task-1", agentSessions: [] }];
    });
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("forced retry failed"),
      );

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 2);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledTimes(2);
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not replay stale task records when task IDs change during conflict retry", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({ ...state.props, taskIds: [] });

      retry.resolve([{ taskId: "task-1", agentSessions: [record] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not surface a stale retry failure after task IDs change", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({ ...state.props, taskIds: [] });

      retry.reject(new Error("stale retry failed"));
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not restart a new repository for a pending retry from the old repository", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList, (emit, observeIndex) => {
      const repoPath = observeIndex === 1 ? "/repo" : "/repo-b";
      emit(
        createLiveSnapshotEnvelope({
          repoPath,
          sessions:
            observeIndex === 1
              ? [
                  snapshot({
                    ref: { ...snapshot().ref, repoPath },
                    repositoryScope: { kind: "repository" },
                  }),
                ]
              : [],
        }),
      );
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({
        ...state.props,
        taskIds: ["task-2"],
        isLoadingTasks: true,
      });
      await state.harness.run(async () => {
        retry.resolve([{ taskId: "task-1", agentSessions: [record] }]);
        await retry.promise;
        await Promise.resolve();
      });

      state.props.currentWorkspaceRepoPathRef.current = "/repo-b";
      state.props.repoEpochRef.current += 1;
      await state.harness.update({
        ...state.props,
        workspaceRepoPath: "/repo-b",
        taskIds: [],
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "ready" &&
          value.sessionReadModelLoadState.workspaceRepoPath === "/repo-b",
      );

      expect(state.observeAgentSessionLive.mock.calls.map(([input]) => input.repoPath)).toEqual([
        "/repo",
        "/repo-b",
      ]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the persisted collection and reports an initial snapshot association conflict", async () => {
    const state = createState(() => undefined);

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 1);
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      await state.harness.run(() => {
        state.emit(
          createLiveSnapshotEnvelope({
            sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
          }),
        );
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to apply initial live-session snapshot for repo '/repo': Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
        source: "live-stream",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the current collection and records a later delta association conflict", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const identity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        state.emit({
          type: "session_upsert",
          session: snapshot({ repositoryScope: { kind: "repository" } }),
        });
      });

      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.harness.getLatest().getSessionFault(identity)).toEqual({
        message:
          "Failed to apply live-session update: Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps observing transcript events while tasks synchronize", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const transcriptEnvelope = {
      type: "transcript_event",
      provenance: "baseline",
      event: {
        type: "assistant_message",
        externalSessionId: record.externalSessionId,
        messageId: "message-after-record-update",
        message: "Still streaming",
        timestamp: "2026-07-17T14:00:00.000Z",
        sessionRef: snapshot().ref,
      },
    } as const satisfies AgentSessionLiveEnvelope;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({ ...state.props, isLoadingTasks: true });

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.transcriptEvents.close).not.toHaveBeenCalled();

      await state.harness.run(async () => {
        state.emit(transcriptEnvelope);
      });

      expect(state.transcriptEvents.handle).toHaveBeenCalledWith(
        transcriptEnvelope.event,
        "baseline",
      );

      await state.harness.update({ ...state.props, isLoadingTasks: false });
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the active observation stable when stream callbacks refresh", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const refreshedTranscriptEvents: AgentSessionTranscriptEventConsumer = {
      handle: mock(() => undefined),
      flushSession: mock(() => undefined),
      close: mock(() => undefined),
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({
        ...state.props,
        liveSessionPort: { ...state.props.liveSessionPort },
        transcriptEvents: refreshedTranscriptEvents,
      });

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.transcriptEvents.close).toHaveBeenCalledTimes(1);

      await state.harness.run(async () => {
        state.emit({
          type: "transcript_event",
          event: {
            type: "assistant_message",
            externalSessionId: record.externalSessionId,
            messageId: "message-after-callback-refresh",
            message: "Still streaming",
            timestamp: "2026-07-17T14:00:00.000Z",
            sessionRef: snapshot().ref,
          },
        });
      });

      expect(state.transcriptEvents.handle).not.toHaveBeenCalled();
      expect(refreshedTranscriptEvents.handle).toHaveBeenCalledTimes(1);
    } finally {
      await state.harness.unmount();
    }

    expect(state.transcriptEvents.close).toHaveBeenCalledTimes(1);
    expect(refreshedTranscriptEvents.close).toHaveBeenCalledTimes(1);
  });

  test("uses the latest observe callback when stream identity changes", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const secondUnsubscribe = mock(() => undefined);
    const secondObserveAgentSessionLive = mock(
      async (
        _input: { repoPath: string },
        listener: (payload: AgentSessionLiveEnvelope) => void,
      ) => {
        listener(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
        return secondUnsubscribe;
      },
    );
    const refreshedProps = {
      ...state.props,
      liveSessionPort: {
        ...state.props.liveSessionPort,
        observeAgentSessionLive: secondObserveAgentSessionLive,
      },
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update(refreshedProps);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(secondObserveAgentSessionLive).not.toHaveBeenCalled();
      expect(state.unsubscribe).not.toHaveBeenCalled();

      await state.harness.update({ ...refreshedProps, workspaceRepoPath: null });
      expect(state.unsubscribe).toHaveBeenCalledTimes(1);

      await state.harness.update(refreshedProps);
      await state.harness.waitFor(() => secondObserveAgentSessionLive.mock.calls.length === 1);
    } finally {
      await state.harness.unmount();
    }

    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test("presents pending approvals without replying from the client", async () => {
    const mutatingApproval = {
      requestId: "latest-mutating",
      requestType: "file_change" as const,
      title: "Edit file",
      mutation: "mutating" as const,
    };
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      { ...record, role: "spec" },
    );
    const refreshedReplyApproval = mock(
      async (_input: AgentSessionLiveReplyApprovalInput) => undefined,
    );
    const refreshedProps = {
      ...state.props,
      liveSessionPort: {
        ...state.props.liveSessionPort,
        agentSessionLiveReplyApproval: refreshedReplyApproval,
      },
    };
    state.queryClient.setQueryData(
      workspaceQueryKeys.repoConfig("/repo"),
      createReadOnlyRepoConfig(),
    );
    state.queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update(refreshedProps);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);

      await state.harness.run(async () => {
        state.emit({
          type: "session_upsert",
          session: snapshot({
            pendingApprovals: [mutatingApproval],
          }),
        });
      });
      expect(refreshedReplyApproval).not.toHaveBeenCalled();

      expect(state.agentSessionLiveReplyApproval).not.toHaveBeenCalled();

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
    } finally {
      await state.harness.unmount();
    }
  });

  test("unsubscribes exactly once when repository observation resolves after unmount", async () => {
    const state = createState(() => undefined);
    const deferredObservation = createDeferred<() => void>();
    const unsubscribe = mock(() => undefined);
    const observeAgentSessionLive = mock(async () => deferredObservation.promise);
    state.props.liveSessionPort.observeAgentSessionLive = observeAgentSessionLive;
    let observationResolved = false;
    let harnessUnmounted = false;

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => observeAgentSessionLive.mock.calls.length === 1);
      await state.harness.unmount();
      harnessUnmounted = true;

      expect(unsubscribe).not.toHaveBeenCalled();
      deferredObservation.resolve(unsubscribe);
      observationResolved = true;
      await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1), { timeout: 750 });
    } finally {
      try {
        if (!harnessUnmounted) {
          await state.harness.unmount();
        }
      } finally {
        if (!observationResolved) {
          deferredObservation.resolve(unsubscribe);
        }
      }
    }
  });

  test("derives the waiting counter from the same initial snapshot collection commit", async () => {
    const records = [
      record,
      { ...record, externalSessionId: "thread-2", role: "planner" as const },
      { ...record, externalSessionId: "thread-3", role: "qa" as const },
    ];
    const waitingSnapshot = (sessionRecord: AgentSessionRecord): AgentSessionLiveSnapshot =>
      snapshot({
        ref: {
          repoPath: "/repo",
          runtimeKind: sessionRecord.runtimeKind,
          workingDirectory: sessionRecord.workingDirectory,
          externalSessionId: sessionRecord.externalSessionId,
        },
        activity: "waiting_for_permission",
        pendingApprovals: [
          {
            requestId: `approval-${sessionRecord.externalSessionId}`,
            requestType: "command_execution",
            title: "Run command",
          },
        ],
      });
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: records.map(waitingSnapshot) }));
    }, records);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.getSession()?.pendingApprovals).toHaveLength(1);
      expect(state.getSessionActivityStates()).toEqual([
        { externalSessionId: "thread-1", activityState: "waiting_input" },
        { externalSessionId: "thread-2", activityState: "waiting_input" },
        { externalSessionId: "thread-3", activityState: "waiting_input" },
      ]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not resurrect a request resolved during observation", async () => {
    const state = createState((emit) => {
      emit(
        createLiveSnapshotEnvelope({
          sessions: [
            snapshot({
              pendingApprovals: [
                {
                  requestId: "opaque-1",
                  requestType: "command_execution",
                  title: "Run command",
                },
              ],
            }),
          ],
        }),
      );
      emit({
        type: "session_upsert",
        session: snapshot({ pendingApprovals: [] }),
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.pendingApprovals).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("invalidates the combined catalog from the ordered stream", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries = invalidateQueries;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "catalog_invalidated",
          scope: {
            repoPath: "/repo",
            runtimeKind: "codex",
          },
        });
      });

      expect(invalidateQueries).toHaveBeenCalledTimes(1);
      expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ["runtime-catalog", "catalog", "/repo", "codex"],
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("invalidates the combined catalog for the pushed slash command scope", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries = invalidateQueries;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "slash_command_catalog_updated",
          scope: {
            repoPath: "/repo",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree",
          },
          catalog: { commands: [] },
        } satisfies AgentSessionLiveEnvelope);
      });

      expect(invalidateQueries).toHaveBeenCalledTimes(1);
      expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ["runtime-catalog", "catalog", "/repo", "claude", "/repo/worktree"],
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a scoped fault isolated to its exact session identity", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit(
          createLiveSnapshotEnvelope({
            sessions: [
              snapshot(),
              snapshot({
                ref: {
                  repoPath: "/repo",
                  runtimeKind: secondRecord.runtimeKind,
                  workingDirectory: secondRecord.workingDirectory,
                  externalSessionId: secondRecord.externalSessionId,
                },
              }),
            ],
          }),
        );
      },
      [record, secondRecord],
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
      });

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toBeNull();
      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: secondRecord.externalSessionId,
          runtimeKind: secondRecord.runtimeKind,
          workingDirectory: secondRecord.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("shows a Codex title failure without a live-observation prefix", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });
    const message = "Could not sync this Workspace Session title to Codex. Reattach this chat.";

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          ref: snapshot().ref,
          operation: "workspaceSession.title.sync",
          message,
        });
      });

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toEqual({ message });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("records a scoped fault before the initial snapshot without failing the repository", async () => {
    const state = createState((emit) => {
      emit(scopedFault());
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
    } finally {
      await state.harness.unmount();
    }
  });

  test("normalizes repository paths when looking up a scoped fault", async () => {
    const state = createState((emit) => {
      emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault({ ...snapshot().ref, repoPath: "/repo/" }));
      });

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears only the fault matching a successful live session delta", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [record, secondRecord],
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault());
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
        state.emit({
          type: "session_upsert",
          session: snapshot({
            ref: {
              repoPath: "/repo",
              ...secondIdentity,
            },
          }),
        });
      });

      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toBeNull();

      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: { repoPath: "/repo", ...firstIdentity } });
      });
      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toBeNull();
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears only the matching fault when a transcript event recovers a session", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [record, secondRecord],
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };
    const transcriptEvent = {
      type: "assistant_message",
      externalSessionId: secondIdentity.externalSessionId,
      messageId: "recovered-message",
      message: "The session is streaming again.",
      timestamp: "2026-07-17T14:00:00.000Z",
      sessionRef: { repoPath: "/repo", ...secondIdentity },
    } as const;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault({ repoPath: "/repo", ...firstIdentity }));
        state.emit(scopedFault({ repoPath: "/repo", ...secondIdentity }));
        state.emit({ type: "transcript_event", event: transcriptEvent });
      });

      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toBeNull();
      expect(state.transcriptEvents.handle).toHaveBeenCalledWith(transcriptEvent, undefined);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a fault without a session reference as a repository failure", async () => {
    const state = createState((emit) => {
      emit({
        type: "fault",
        repoPath: "/repo",
        message: "The observation stream stopped.",
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message: "Live-session observation failed: The observation stream stopped.",
        source: "live-stream",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps sibling scoped faults when retry fails before observation restarts", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const batchList = mock(async () => {
      throw new Error("retry failed");
    });
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      [record, secondRecord],
      {
        agentSessionsListForTasks: batchList,
      },
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("initial retry trigger");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("initial retry trigger");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");
      await state.harness.run(() => {
        state.emit(scopedFault());
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
        state.harness.getLatest().reloadSessionReadModel();
      });
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("retry recovers a failed task session query without reloading healthy caches", async () => {
    const recoveredRecord = { ...record, externalSessionId: "thread-recovered" };
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [recoveredRecord] }]);
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      record,
      {
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("temporary exact refresh failure");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("temporary exact refresh failure");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => {
        state.harness.getLatest().reloadSessionReadModel();
      });

      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([recoveredRecord]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("concurrent explicit retries share a current read and can recover after its failure", async () => {
    const pendingRetry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() =>
      batchList.mock.calls.length === 1
        ? pendingRetry.promise
        : Promise.resolve([{ taskId: "task-1", agentSessions: [record] }]),
    );
    const state = createState(
      (emit) => {
        emit(createLiveSnapshotEnvelope({ sessions: [snapshot()] }));
      },
      record,
      { agentSessionsListForTasks: batchList },
    );
    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("initial refresh failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("initial refresh failed");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");
      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      expect(batchList).toHaveBeenCalledTimes(1);
      pendingRetry.reject(new Error("retry unavailable"));
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.includes("retry unavailable"),
      );
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([record]);
      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(batchList).toHaveBeenCalledTimes(2);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps initial and new approvals for the host policy", async () => {
    const initialApproval = {
      requestId: "initial-mutating",
      requestType: "file_change" as const,
      title: "Edit file",
      mutation: "mutating" as const,
    };
    const laterApproval = {
      ...initialApproval,
      requestId: "later-mutating",
    };
    const state = createState(
      (emit) => {
        emit(
          createLiveSnapshotEnvelope({
            sessions: [
              snapshot({
                pendingApprovals: [initialApproval],
              }),
            ],
          }),
        );
      },
      { ...record, role: "spec" },
    );
    state.queryClient.setQueryData(
      workspaceQueryKeys.repoConfig("/repo"),
      createReadOnlyRepoConfig(),
    );
    state.queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.agentSessionLiveReplyApproval).not.toHaveBeenCalled();
      expect(state.getSession()?.pendingApprovals.map(({ requestId }) => requestId)).toEqual([
        "initial-mutating",
      ]);

      await state.harness.run(async () => {
        state.emit({
          type: "session_upsert",
          session: snapshot({
            pendingApprovals: [initialApproval, laterApproval],
          }),
        });
      });

      expect(state.agentSessionLiveReplyApproval).not.toHaveBeenCalled();

      expect(state.getSession()?.pendingApprovals.map(({ requestId }) => requestId)).toEqual([
        "initial-mutating",
        "later-mutating",
      ]);
    } finally {
      await state.harness.unmount();
    }
  });
});
