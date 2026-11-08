import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentSessionGoalCommand, AgentSessionSummary } from "@openducktor/core";
import { interruptedTurnResumeError } from "@openducktor/core";
import { Effect } from "effect";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type {
  ClaudeAgentSdkService,
  ClaudePendingInputResolution,
} from "../../application/runtimes/claude-agent-sdk-service";
import type { RuntimeWorkingDirectoryDependencies } from "../../application/runtimes/runtime-working-directory";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { AsyncInputQueue } from "../claude/claude-agent-sdk-queue";
import { observeClaudeGoalFrame } from "../claude/claude-agent-sdk-goals";
import type { ClaudeProtocolObject } from "../claude/claude-agent-sdk-ingress-schemas";
import { consumeClaudeSession, sendClaudeUserMessage } from "../claude/claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createNonAdmittingClaudeSession,
  ignoreClaudeBackgroundFailure,
  throwingClaudeQuery,
} from "../claude/claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "../claude/claude-agent-sdk-test-messages";
import { createClaudeAgentSdkSessionStore } from "../claude/claude-agent-sdk-session-store";
import { beginClaudeSessionClose } from "../claude/claude-agent-sdk-session-lifecycle";
import type { ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import {
  createClaudeAgentSdkEventHub,
  createClaudeLiveSessionAdapterPreparer,
} from "./claude-live-session-adapter";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const runtime = {
  kind: "claude" as const,
  runtimeId: "runtime-1",
  runtimeRoute: { type: "host_service" as const, identity: "runtime-1" },
  startedAt: "2026-07-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

const workingDirectoryDependencies = {
  gitPort: createGitPortTestDouble({
    isGitRepository: () => Effect.succeed(false),
    readCheckout: () => Effect.succeed(null),
  }),
  settingsConfig: {
    canonicalizePath: (path: string) => Effect.succeed(path),
    defaultRepoWorktreeBasePath: () => "/legacy-worktrees/repo",
    defaultWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (path: string) => path,
  },
  workspaceSettingsService: {
    getRepoConfig: (workspaceId: string) =>
      Effect.succeed(
        repoConfigFixture(
          workspaceId === "other-repo"
            ? { workspaceId, workspaceName: "Other", repoPath: "/other-repo" }
            : { worktreeBasePath: "/worktrees/repo" },
        ),
      ),
    getRepoConfigByRepoPath: () =>
      Effect.succeed(
        repoConfigFixture({
          worktreeBasePath: "/worktrees/repo",
        }),
      ),
  },
};

const summary = {
  externalSessionId: "session-1",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  title: "Claude build",
  sessionAssociation: { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
  startedAt: "2026-07-17T10:01:00.000Z",
  status: "idle",
} as const satisfies AgentSessionSummary;

const session: ClaudeSessionContext = {
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", workspaceId: "repo", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  pendingUserMessageAdmissions: new Map(),
  unreadSteeredUserMessages: new Map(),
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: summary.startedAt,
  summary,
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
  // Goal restores read no transcript of the host user.
  transcriptEnvironment: { CLAUDE_CONFIG_DIR: join(tmpdir(), "openducktor-missing-claude-config") },
};

const otherSummary = {
  ...summary,
  externalSessionId: "session-2",
  workingDirectory: "/other-repo",
  title: "Other repo session",
  sessionAssociation: { kind: "repository", workspaceId: "other-repo" },
} as const satisfies AgentSessionSummary;

const otherSession: ClaudeSessionContext = {
  ...session,
  externalSessionId: "session-2",
  input: {
    ...session.input,
    repoPath: "/other-repo",
    workingDirectory: "/other-repo",
    sessionScope: { kind: "repository", workspaceId: "other-repo" },
  },
  startedAt: otherSummary.startedAt,
  summary: otherSummary,
};

const otherStartInput = {
  repoPath: "/other-repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/other-repo",
  sessionScope: { kind: "repository" as const, workspaceId: "other-repo" },
  systemPrompt: "Help",
};

const sessionRef = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const otherSessionRef = {
  repoPath: "/other-repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/other-repo",
  externalSessionId: "session-2",
};

const sessionsById = new Map([
  [session.externalSessionId, session],
  [otherSession.externalSessionId, otherSession],
]);

const startInput = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
  sessionScope: {
    kind: "workflow" as const,
    workspaceId: "repo",
    taskId: "task-1",
    role: "build" as const,
  },
  systemPrompt: "Build",
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type MutationBarrier = {
  entered: ReturnType<typeof deferred<void>>;
  release: ReturnType<typeof deferred<void>>;
};

const createHarness = async (
  workingDirectoryDependenciesOverride: RuntimeWorkingDirectoryDependencies = workingDirectoryDependencies,
  sessionStore: Parameters<typeof createClaudeLiveSessionAdapterPreparer>[0]["sessionStore"] = {
    get: (externalSessionId) => sessionsById.get(externalSessionId),
    isLatest: (candidate) => sessionsById.get(candidate.externalSessionId) === candidate,
  },
) => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const eventHub = createClaudeAgentSdkEventHub();
  let startSessionImpl: ClaudeAgentSdkService["startSession"] = () =>
    Effect.die("startSession was not configured");
  let forkSessionImpl: ClaudeAgentSdkService["forkSession"] = () =>
    Effect.die("forkSession was not configured");
  let resumeSessionImpl: ClaudeAgentSdkService["resumeSession"] = () => Effect.succeed(summary);
  let continueInterruptedTurnImpl: ClaudeAgentSdkService["continueInterruptedTurn"] = () =>
    Effect.succeed(summary);
  let loadSessionContextUsageImpl: ClaudeAgentSdkService["loadSessionContextUsage"] = () =>
    Effect.die("loadSessionContextUsage was not configured");
  let sendUserMessageImpl: ClaudeAgentSdkService["sendUserMessage"] = () =>
    Effect.die("sendUserMessage was not configured");
  let prepareApprovalReplyImpl: ClaudeAgentSdkService["prepareApprovalReply"] = () =>
    Effect.die("prepareApprovalReply was not configured");
  let prepareQuestionReplyImpl: ClaudeAgentSdkService["prepareQuestionReply"] = () =>
    Effect.die("prepareQuestionReply was not configured");
  let updateSessionModelImpl: ClaudeAgentSdkService["updateSessionModel"] = () =>
    Effect.die("updateSessionModel was not configured");
  let updateSessionTitleImpl: ClaudeAgentSdkService["updateSessionTitle"] = () =>
    Effect.die("updateSessionTitle was not configured");
  let stopSessionImpl: ClaudeAgentSdkService["stopSession"] = () => Effect.void;
  let releaseSessionImpl: ClaudeAgentSdkService["releaseSession"] = () => Effect.void;
  let stopSessionsForRuntimeImpl: ClaudeAgentSdkService["stopSessionsForRuntime"] = () =>
    Effect.void;
  let disposeImpl: ClaudeAgentSdkService["dispose"] = () => Effect.void;
  let inspectSessionForImportImpl: ClaudeAgentSdkService["inspectSessionForImport"] = () =>
    Effect.die(new Error("Unexpected import"));
  let failNextMutationAfterApply = false;
  let failMutationEventType: string | undefined;
  let mutationsBeforeFailure = 0;
  let mutationBarrier: MutationBarrier | undefined;
  startSessionImpl = () => {
    eventHub.emit(session, {
      type: "session_started",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:00.000Z",
      message: "Started build session",
    });
    eventHub.emit(session, {
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:01.000Z",
    });
    return Effect.succeed(summary);
  };
  const service = {
    ...unexpectedRuntimeQueries,
    resolvePendingApproval: () => Effect.die(new Error("unexpected pending approval resolution")),
    loadToolCatalog: () => Effect.die("Unexpected Claude tool catalog read"),
    inspectSessionForImport: (
      input: Parameters<ClaudeAgentSdkService["inspectSessionForImport"]>[0],
      runtimeId: string,
    ) => inspectSessionForImportImpl(input, runtimeId),
    startSession: (
      input: Parameters<ClaudeAgentSdkService["startSession"]>[0],
      runtimeId: string,
    ) => startSessionImpl(input, runtimeId),
    forkSession: (input: Parameters<ClaudeAgentSdkService["forkSession"]>[0], runtimeId: string) =>
      forkSessionImpl(input, runtimeId),
    resumeSession: (
      input: Parameters<ClaudeAgentSdkService["resumeSession"]>[0],
      runtimeId: string,
    ) => resumeSessionImpl(input, runtimeId),
    continueInterruptedTurn: (
      input: Parameters<ClaudeAgentSdkService["continueInterruptedTurn"]>[0],
      runtimeId: string,
      onContinuationAdmission?: () => void,
    ) => continueInterruptedTurnImpl(input, runtimeId, onContinuationAdmission),
    loadSessionContextUsage: (
      input: Parameters<ClaudeAgentSdkService["loadSessionContextUsage"]>[0],
    ) => loadSessionContextUsageImpl(input),
    sendUserMessage: (
      input: Parameters<ClaudeAgentSdkService["sendUserMessage"]>[0],
      runtimeId: string,
      options?: Parameters<ClaudeAgentSdkService["sendUserMessage"]>[2],
    ) => sendUserMessageImpl(input, runtimeId, options),
    prepareApprovalReply: (input: Parameters<ClaudeAgentSdkService["prepareApprovalReply"]>[0]) =>
      prepareApprovalReplyImpl(input),
    prepareQuestionReply: (input: Parameters<ClaudeAgentSdkService["prepareQuestionReply"]>[0]) =>
      prepareQuestionReplyImpl(input),
    updateSessionModel: (input, runtimeId) => updateSessionModelImpl(input, runtimeId),
    updateSessionTitle: (input: Parameters<ClaudeAgentSdkService["updateSessionTitle"]>[0]) =>
      updateSessionTitleImpl(input),
    stopSession: (input: Parameters<ClaudeAgentSdkService["stopSession"]>[0]) =>
      stopSessionImpl(input),
    stopSessionsForRuntime: (runtimeId: string) => stopSessionsForRuntimeImpl(runtimeId),
    dispose: () => disposeImpl(),
    releaseSession: (input: Parameters<ClaudeAgentSdkService["releaseSession"]>[0]) =>
      releaseSessionImpl(input),
  } satisfies Parameters<typeof createClaudeLiveSessionAdapterPreparer>[0]["service"];
  const liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "createRuntimeRegistration"> = {
    createRuntimeRegistration: (binding) =>
      new AgentSessionLiveRegistration(binding, (mutation) => {
        const barrier = mutationBarrier;
        mutationBarrier = undefined;
        const waitForBarrier = barrier
          ? Effect.promise(async () => {
              barrier.entered.resolve();
              await barrier.release.promise;
            })
          : Effect.void;
        return waitForBarrier.pipe(
          Effect.andThen(
            Effect.flatMap(mutation, ({ value, changes: mutationChanges }) => {
              if (
                failNextMutationAfterApply &&
                (failMutationEventType === undefined ||
                  mutationChanges.some(
                    (change) =>
                      change.type === "transcript_event" &&
                      change.event.type === failMutationEventType,
                  )) &&
                mutationsBeforeFailure-- <= 0
              ) {
                failNextMutationAfterApply = false;
                return Effect.fail(
                  new HostOperationError({
                    operation: "test.publish",
                    message: "Publication failed.",
                  }),
                );
              }
              changes.push(...mutationChanges);
              return Effect.succeed(value);
            }),
          ),
        );
      }),
  };
  const prepareInput: Parameters<typeof createClaudeLiveSessionAdapterPreparer>[0] = {
    eventHub,
    liveSessionLifecycle,
    service,
    sessionStore,
    workingDirectoryDependencies: workingDirectoryDependenciesOverride,
  };
  const prepare = createClaudeLiveSessionAdapterPreparer(prepareInput);
  const prepared = await Effect.runPromise(prepare(runtime));
  await Effect.runPromise(prepared.startForwarding());
  return {
    adapter: prepared.adapter,
    changes,
    eventHub,
    setStartSession: (implementation: ClaudeAgentSdkService["startSession"]) => {
      startSessionImpl = implementation;
    },
    setForkSession: (implementation: ClaudeAgentSdkService["forkSession"]) => {
      forkSessionImpl = implementation;
    },
    setResumeSession: (implementation: ClaudeAgentSdkService["resumeSession"]) => {
      resumeSessionImpl = implementation;
    },
    setContinueInterruptedTurn: (
      implementation: ClaudeAgentSdkService["continueInterruptedTurn"],
    ) => {
      continueInterruptedTurnImpl = implementation;
    },
    setLoadSessionContextUsage: (
      implementation: ClaudeAgentSdkService["loadSessionContextUsage"],
    ) => {
      loadSessionContextUsageImpl = implementation;
    },
    pauseNextMutation: () => {
      const barrier = { entered: deferred<void>(), release: deferred<void>() };
      mutationBarrier = barrier;
      return barrier;
    },
    /** `skip` lets that many earlier mutations succeed first. */
    failNextMutationAfterStateApply: (eventType?: string, skip = 0) => {
      failNextMutationAfterApply = true;
      failMutationEventType = eventType;
      mutationsBeforeFailure = skip;
    },
    setPrepareApprovalReply: (implementation: ClaudeAgentSdkService["prepareApprovalReply"]) => {
      prepareApprovalReplyImpl = implementation;
    },
    setPrepareQuestionReply: (implementation: ClaudeAgentSdkService["prepareQuestionReply"]) => {
      prepareQuestionReplyImpl = implementation;
    },
    setSendUserMessage: (implementation: ClaudeAgentSdkService["sendUserMessage"]) => {
      sendUserMessageImpl = implementation;
    },
    setUpdateSessionModel: (implementation: ClaudeAgentSdkService["updateSessionModel"]) => {
      updateSessionModelImpl = implementation;
    },
    setUpdateSessionTitle: (implementation: ClaudeAgentSdkService["updateSessionTitle"]) => {
      updateSessionTitleImpl = implementation;
    },
    setStopSession: (implementation: ClaudeAgentSdkService["stopSession"]) => {
      stopSessionImpl = implementation;
    },
    setReleaseSession: (implementation: ClaudeAgentSdkService["releaseSession"]) => {
      releaseSessionImpl = implementation;
    },
    setStopSessionsForRuntime: (
      implementation: ClaudeAgentSdkService["stopSessionsForRuntime"],
    ) => {
      stopSessionsForRuntimeImpl = implementation;
    },
    setDispose: (implementation: ClaudeAgentSdkService["dispose"]) => {
      disposeImpl = implementation;
    },
    setInspectSessionForImport: (
      implementation: ClaudeAgentSdkService["inspectSessionForImport"],
    ) => {
      inspectSessionForImportImpl = implementation;
    },
  };
};

const transcriptEventTypes = (changes: readonly AgentSessionLiveAdapterChange[]): string[] =>
  changes.flatMap((change) => (change.type === "transcript_event" ? [change.event.type] : []));

describe("Claude host live-session adapter", () => {
  test("delivers the native stream failure before finish while send waits for admission", async () => {
    const cause = new Error("Claude native stream failed before command admission.");
    const current = createNonAdmittingClaudeSession({
      input: { ...session.input },
      runtimeId: runtime.runtimeId,
      query: throwingClaudeQuery(cause),
      summary: { ...summary },
    });
    const store = createClaudeAgentSdkSessionStore();
    store.set(current);
    const harness = await createHarness(workingDirectoryDependencies, store);
    harness.setStartSession(() => Effect.succeed(current.summary));
    harness.setLoadSessionContextUsage(() => Effect.succeed(null));
    const sent = deferred<void>();
    harness.setSendUserMessage((messageInput, _runtimeId, options) =>
      Effect.tryPromise({
        try: () =>
          sendClaudeUserMessage({
            messageInput,
            session: current,
            emit: harness.eventHub.emit,
            now: () => "2026-10-23T00:00:00.000Z",
            randomId: () => "11111111-1111-4111-8111-111111111111",
            onSent: () => {
              sent.resolve();
              options?.onSent?.();
            },
          }),
        catch: (failure) => toHostOperationError(failure, "claudeRuntime.sendUserMessage"),
      }),
    );
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    const sending = Effect.runPromise(
      Effect.result(
        harness.adapter.sendUserMessage({
          ...sessionRef,
          sessionScope: current.input.sessionScope,
          delivery: "new_turn",
          parts: [{ kind: "text", text: "Build" }],
        }),
      ),
    );
    await sent.promise;
    expect(current.pendingUserMessageAdmissions.size).toBe(1);
    await consumeClaudeSession({
      emit: harness.eventHub.emit,
      now: () => "2026-10-23T00:00:01.000Z",
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      session: current,
      sessionStore: store,
    });
    expect((await sending)._tag).toBe("Failure");
    await Effect.runPromise(harness.adapter.loadContext(sessionRef));
    const terminalEvents = harness.changes.flatMap((change) =>
      change.type === "transcript_event" &&
      (change.event.type === "session_error" || change.event.type === "session_finished")
        ? [change.event]
        : [],
    );
    expect(terminalEvents).toMatchObject([
      { type: "session_error", message: cause.message },
      { type: "session_finished" },
    ]);
    expect(store.get(current.externalSessionId)).toBeUndefined();
  });

  test.each(["success", "failure"] as const)(
    "delivers accepted turn output after natural stream closure: %s",
    async (outcome) => {
      const result =
        outcome === "success"
          ? claudeSdkMessageFixture({
              type: "result",
              uuid: "b2df82cf-31ea-4a64-a43f-7bf755178e2d",
              subtype: "success",
              result: "The reply is complete.",
              stop_reason: "end_turn",
            })
          : claudeSdkMessageFixture({
              type: "result",
              uuid: "b2df82cf-31ea-4a64-a43f-7bf755178e2d",
              subtype: "error_max_turns",
              errors: ["The native turn failed."],
            });
      const current = createNonAdmittingClaudeSession({
        input: { ...session.input },
        runtimeId: runtime.runtimeId,
        summary: { ...summary },
        query: claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "assistant",
            uuid: "2c303b60-a614-4daa-b04d-1b6268985313",
            message: {
              id: "native-reply",
              role: "assistant",
              model: "claude-haiku-5-5",
              stop_reason: null,
              content: [{ type: "text", text: "The reply is complete." }],
            },
          }),
          result,
        ]),
      });
      const store = createClaudeAgentSdkSessionStore();
      store.set(current);
      const harness = await createHarness(workingDirectoryDependencies, store);
      harness.setStartSession(() => Effect.succeed(current.summary));
      harness.setLoadSessionContextUsage(() => Effect.succeed(null));
      await Effect.runPromise(harness.adapter.startSession(startInput));
      harness.changes.splice(0);
      const entered = deferred<void>();
      const release = deferred<void>();
      harness.setUpdateSessionModel(() =>
        Effect.promise(async () => {
          entered.resolve();
          await release.promise;
        }),
      );
      const updating = Effect.runPromise(
        harness.adapter.updateSessionModel({
          ...sessionRef,
          sessionScope: current.input.sessionScope,
          model: null,
        }),
      );
      await entered.promise;
      try {
        await consumeClaudeSession({
          emit: harness.eventHub.emit,
          now: () => "2026-10-24T16:00:00.000Z",
          onBackgroundFailure: ignoreClaudeBackgroundFailure,
          session: current,
          sessionStore: store,
        });
      } finally {
        release.resolve();
      }
      await updating;
      const terminalEvents = harness.changes.flatMap((change) =>
        change.type === "transcript_event" &&
        ["assistant_message", "turn_error", "session_turn_finished", "session_finished"].includes(
          change.event.type,
        )
          ? [change.event]
          : [],
      );
      expect(terminalEvents).toMatchObject(
        outcome === "success"
          ? [
              { type: "assistant_message", message: "The reply is complete." },
              { type: "session_turn_finished", turnOutcome: "completed" },
              { type: "session_finished" },
            ]
          : [
              { type: "turn_error", message: "The native turn failed." },
              { type: "session_turn_finished", turnOutcome: "failed" },
              { type: "session_finished" },
            ],
      );
      expect(store.get(current.externalSessionId)).toBeUndefined();
    },
  );

  test.each([
    "latest closed",
    "unconfirmed closing",
    "after Stop",
    "replacement live",
    "replacement closed",
  ] as const)("keeps queued events within their execution: %s", async (scenario) => {
    const store = createClaudeAgentSdkSessionStore();
    const current = createNonAdmittingClaudeSession({
      input: { ...session.input },
      runtimeId: runtime.runtimeId,
      summary: { ...summary },
    });
    store.set(current);
    const harness = await createHarness(workingDirectoryDependencies, store);
    harness.setStartSession(() => Effect.succeed(current.summary));
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    const entered = deferred<void>();
    const release = deferred<void>();
    harness.setUpdateSessionModel(() =>
      Effect.promise(async () => {
        entered.resolve();
        await release.promise;
      }),
    );
    const updating = Effect.runPromise(
      harness.adapter.updateSessionModel({
        ...sessionRef,
        sessionScope: current.input.sessionScope,
        model: null,
      }),
    );
    await entered.promise;
    try {
      if (scenario === "after Stop") await Effect.runPromise(store.stopSession(sessionRef));
      harness.eventHub.emit(current, {
        type: "session_error",
        externalSessionId: current.externalSessionId,
        timestamp: "2026-10-23T00:00:00.000Z",
        message: "Failure from the old execution",
      });
      harness.eventHub.emit(current, {
        type: "assistant_message",
        externalSessionId: current.externalSessionId,
        timestamp: "2026-10-23T00:00:00.000Z",
        messageId: "queued-reply",
        message: "The accepted reply",
      });
      if (scenario === "unconfirmed closing") beginClaudeSessionClose(current);
      else if (scenario !== "after Stop") store.close(current);
      if (scenario === "replacement live" || scenario === "replacement closed") {
        const replacement = createNonAdmittingClaudeSession({
          input: { ...session.input },
          runtimeId: runtime.runtimeId,
          summary: { ...summary },
        });
        store.set(replacement);
        if (scenario === "replacement closed") store.close(replacement);
      }
    } finally {
      release.resolve();
    }
    await updating;
    const errorMessages = harness.changes.flatMap((change) =>
      change.type === "transcript_event" && change.event.type === "session_error"
        ? [change.event.message]
        : [],
    );
    expect(errorMessages).toEqual(
      scenario === "latest closed" || scenario === "unconfirmed closing"
        ? ["Failure from the old execution"]
        : [],
    );
    expect(
      harness.changes.flatMap((change) =>
        change.type === "transcript_event" && change.event.type === "assistant_message"
          ? [change.event.messageId]
          : [],
      ),
    ).toEqual(scenario === "latest closed" ? ["queued-reply"] : []);
  });

  test.each(["Stop", "runtime release"] as const)(
    "delivers an accepted error before finish during %s",
    async (operation) => {
      const current = createNonAdmittingClaudeSession({
        input: { ...session.input },
        runtimeId: runtime.runtimeId,
        summary: { ...summary },
      });
      const store = createClaudeAgentSdkSessionStore({
        emit: (source, event) => harness.eventHub.emit(source, event),
      });
      store.set(current);
      const harness = await createHarness(workingDirectoryDependencies, store);
      harness.setStartSession(() => Effect.succeed(current.summary));
      await Effect.runPromise(harness.adapter.startSession(startInput));
      harness.changes.splice(0);
      const publishFailure = Effect.sync(() =>
        harness.eventHub.emit(current, {
          type: "session_error",
          externalSessionId: current.externalSessionId,
          timestamp: "2026-10-23T00:00:00.000Z",
          message: "Native stream failed during cleanup",
        }),
      );
      harness.setStopSession((input) =>
        publishFailure.pipe(Effect.andThen(store.stopSession(input))),
      );
      harness.setStopSessionsForRuntime((runtimeId) =>
        publishFailure.pipe(Effect.andThen(store.stopSessionsForRuntime(runtimeId))),
      );
      if (operation === "Stop") await Effect.runPromise(harness.adapter.stopSession(sessionRef));
      else await Effect.runPromise(harness.adapter.releaseRuntime());
      expect(transcriptEventTypes(harness.changes)).toEqual(["session_error", "session_finished"]);
    },
  );

  test("rejects old query events at acceptance and after a queued projection waits", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    const replacement = { ...session };
    const barrier = harness.pauseNextMutation();
    const message = (messageId: string) => ({
      type: "assistant_message" as const,
      externalSessionId: session.externalSessionId,
      timestamp: "2026-10-23T00:00:00.000Z",
      messageId,
      message: messageId,
    });
    harness.eventHub.emit(session, message("old-before-replacement"));
    await barrier.entered.promise;
    try {
      sessionsById.set(session.externalSessionId, replacement);
      harness.eventHub.emit(session, message("old-after-replacement"));
      harness.eventHub.emit(replacement, message("replacement-message"));
      barrier.release.resolve();
      await Effect.runPromise(
        harness.adapter.resumeSession({
          ...startInput,
          externalSessionId: session.externalSessionId,
          resumeMode: "reattach",
        }),
      );
      expect(
        harness.changes.flatMap((change) =>
          change.type === "transcript_event" && change.event.type === "assistant_message"
            ? [change.event.messageId]
            : [],
        ),
      ).toEqual(["replacement-message"]);
    } finally {
      barrier.release.resolve();
      sessionsById.set(session.externalSessionId, session);
    }
  });

  test("delegates interrupted-turn resume to the Claude service", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    const calls: Array<{ input: unknown; runtimeId: string }> = [];
    harness.setContinueInterruptedTurn((input, runtimeId) => {
      calls.push({ input, runtimeId });
      return Effect.succeed(summary);
    });

    const result = await Effect.runPromise(
      harness.adapter.continueInterruptedTurn({
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    expect(result).toMatchObject({
      externalSessionId: "session-1",
      runtimeKind: "claude",
      workingDirectory: "/repo/worktree",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toMatchObject({
      repoPath: "/repo",
      externalSessionId: "session-1",
      workingDirectory: "/repo/worktree",
      runtimeKind: "claude",
      runtimePolicy: { kind: "claude" },
      systemPrompt: "Build",
    });
  });

  test("maps a native continuation identity mismatch to the typed resume failure", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    harness.setContinueInterruptedTurn(() =>
      Effect.fail(
        toHostOperationError(
          interruptedTurnResumeError({
            reason: "identity_mismatch",
            message:
              "Cannot continue interrupted turn Claude session 'session-1' from repo '/repo' and working directory '/repo/worktree'.",
          }),
          "claudeRuntime.continueInterruptedTurn",
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.adapter.continueInterruptedTurn({
          ...startInput,
          externalSessionId: "session-1",
        }),
      ),
    );

    expect(failure).toBeInstanceOf(AgentSessionResumeError);
    expect(failure).toMatchObject({
      reason: "identity_mismatch",
      operation: "claude-live-session.continue-interrupted-turn",
      nextAction:
        "Reopen the session from the session list so the stored identity matches, then retry Resume.",
    });
  });

  test("serializes new-message advice when Claude does not admit the continuation", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    harness.setContinueInterruptedTurn(() =>
      Effect.fail(
        toHostOperationError(
          interruptedTurnResumeError({
            reason: "continuation_failed",
            message:
              "Claude Code did not start the continuation for session 'session-1'. Send a new message to continue.",
          }),
          "claudeRuntime.createSession",
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.adapter.continueInterruptedTurn({
          ...startInput,
          externalSessionId: "session-1",
        }),
      ),
    );

    expect(hostInvokeFailureFromError(failure)).toMatchObject({
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "continuation_failed",
        message:
          "Claude Code did not start the continuation for session 'session-1'. Send a new message to continue.",
        nextAction: "Send a new message to continue.",
      },
    });
  });

  test("preserves source-specific recovery advice before native admission", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    harness.setContinueInterruptedTurn(() =>
      Effect.fail(
        new HostOperationError({
          operation: "claudeRuntime.createSession",
          message: "Claude initialization timed out. Check authentication and connectivity.",
        }),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.adapter.continueInterruptedTurn({
          ...startInput,
          externalSessionId: "session-1",
        }),
      ),
    );

    expect(hostInvokeFailureFromError(failure)).toMatchObject({
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "continuation_failed",
        message: "Claude initialization timed out. Check authentication and connectivity.",
        nextAction: "Resolve the reported runtime failure, then retry Resume.",
      },
    });
  });

  test("serializes inspect-session advice when retaining an admitted continuation fails", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    harness.setContinueInterruptedTurn((_input, _runtimeId, onContinuationAdmission) =>
      Effect.sync(() => onContinuationAdmission?.()).pipe(
        Effect.as({ ...summary, status: "running" as const }),
      ),
    );
    // The goal restore commits first, and the summary commit after it fails.
    harness.failNextMutationAfterStateApply(undefined, 1);

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.adapter.continueInterruptedTurn({
          ...startInput,
          externalSessionId: "session-1",
        }),
      ),
    );

    expect(hostInvokeFailureFromError(failure)).toMatchObject({
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "continuation_failed",
        message:
          "Publication failed. The adapter already accepted the continuation, so the runtime can be working on it.",
        nextAction:
          "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
      },
    });
  });

  test("serializes inspect-session advice when startup fails after native admission", async () => {
    const harness = await createHarness(workingDirectoryDependencies);
    harness.setContinueInterruptedTurn((_input, _runtimeId, onContinuationAdmission) =>
      Effect.sync(() => onContinuationAdmission?.()).pipe(
        Effect.andThen(
          Effect.fail(
            new HostOperationError({
              operation: "claudeRuntime.createSession",
              message: "Claude startup failed after admission.",
            }),
          ),
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        harness.adapter.continueInterruptedTurn({
          ...startInput,
          externalSessionId: "session-1",
        }),
      ),
    );

    expect(hostInvokeFailureFromError(failure)).toMatchObject({
      kind: "agent_session_resume",
      agentSessionResumeFailure: {
        reason: "continuation_failed",
        message:
          "Claude startup failed after admission. The adapter already accepted the continuation, so the runtime can be working on it.",
        nextAction:
          "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
      },
    });
  });

  test.each(["user_message", "session_status"])(
    "retains acceptance when %s publication fails",
    async (eventType) => {
      const harness = await createHarness();
      await Effect.runPromise(
        harness.adapter.resumeSession({
          resumeMode: "reattach",
          ...startInput,
          externalSessionId: "session-1",
        }),
      );
      let sends = 0;
      harness.setSendUserMessage((input) =>
        Effect.sync(() => {
          sends += 1;
          harness.eventHub.emit(session, {
            type: "session_status",
            externalSessionId: input.externalSessionId,
            timestamp: "2026-09-12T10:00:00Z",
            status: { type: "busy", message: null },
          });
          return {
            type: "user_message" as const,
            externalSessionId: input.externalSessionId,
            timestamp: "2026-09-12T10:00:00Z",
            messageId: "accepted-1",
            message: "Hello",
            parts: [],
            state: "read" as const,
          };
        }),
      );
      harness.failNextMutationAfterStateApply(eventType);
      const result = await Effect.runPromise(
        Effect.result(
          harness.adapter.sendUserMessage({
            delivery: "new_turn",
            ...startInput,
            externalSessionId: "session-1",
            parts: [{ kind: "text", text: "Hello" }],
          }),
        ),
      );
      expect(sends).toBe(1);
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected publication failure");
      expect(result.failure).toBeInstanceOf(AgentSessionMessageAcceptedError);
      expect(result.failure).toMatchObject({
        failure: { stage: "live_update", acceptedMessage: { messageId: "accepted-1" } },
      });
    },
  );
  test("forwards repository controls after workspace validation", async () => {
    const harness = await createHarness();
    const repositoryInput = {
      ...startInput,
      sessionScope: { kind: "repository", workspaceId: "repo" } as const,
    };
    const repositorySummary = {
      ...summary,
      title: "Repository session",
      sessionAssociation: { kind: "repository", workspaceId: "repo" } as const,
    };
    const calls: Array<{ operation: string; sessionScope: unknown; runtimeId: string }> = [];
    harness.setStartSession((input, runtimeId) => {
      calls.push({ operation: "start", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    harness.setResumeSession((input, runtimeId) => {
      calls.push({ operation: "resume", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    harness.setForkSession((input, runtimeId) => {
      calls.push({ operation: "fork", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    const loadContextScopes: unknown[] = [];
    harness.setLoadSessionContextUsage((input) => {
      loadContextScopes.push(input.sessionScope);
      return Effect.succeed(null);
    });
    harness.setSendUserMessage((input, runtimeId, options) => {
      calls.push({ operation: "send", sessionScope: input.sessionScope, runtimeId });
      options?.onSent?.();
      return Effect.succeed({
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-17T10:02:00.000Z",
        messageId: "user-1",
        message: "Start",
        parts: [{ kind: "text", text: "Start" }],
        state: "read",
      });
    });

    await Effect.runPromise(harness.adapter.startSession(repositoryInput));
    await Effect.runPromise(
      harness.adapter.resumeSession({
        resumeMode: "reattach",
        ...repositoryInput,
        externalSessionId: "session-1",
      }),
    );
    await Effect.runPromise(
      harness.adapter.forkSession({
        ...repositoryInput,
        parentExternalSessionId: "parent-session",
      }),
    );
    let sent = 0;
    await Effect.runPromise(
      harness.adapter.sendUserMessage(
        {
          delivery: "new_turn",
          ...repositoryInput,
          externalSessionId: "session-1",
          parts: [{ kind: "text", text: "Start" }],
        },
        {
          onSent: () => {
            sent += 1;
          },
        },
      ),
    );
    // The SDK service reports when the message enters its input queue.
    expect(sent).toBe(1);
    await Effect.runPromise(
      harness.adapter.loadContext({
        ...repositoryInput,
        externalSessionId: "session-1",
      }),
    );

    expect(calls).toEqual([
      {
        operation: "start",
        sessionScope: { kind: "repository", workspaceId: "repo" },
        runtimeId: "runtime-1",
      },
      {
        operation: "resume",
        sessionScope: { kind: "repository", workspaceId: "repo" },
        runtimeId: "runtime-1",
      },
      {
        operation: "fork",
        sessionScope: { kind: "repository", workspaceId: "repo" },
        runtimeId: "runtime-1",
      },
      {
        operation: "send",
        sessionScope: { kind: "repository", workspaceId: "repo" },
        runtimeId: "runtime-1",
      },
    ]);
    expect(loadContextScopes).toEqual([{ kind: "repository", workspaceId: "repo" }]);
  });

  test("rejects session operations outside the selected workspace before calling the SDK", async () => {
    const harness = await createHarness();
    const sdkCalls = { start: 0, resume: 0, fork: 0, loadContext: 0, sendUserMessage: 0 };
    harness.setStartSession(() => {
      sdkCalls.start += 1;
      return Effect.succeed(summary);
    });
    harness.setResumeSession(() => {
      sdkCalls.resume += 1;
      return Effect.succeed(summary);
    });
    harness.setForkSession(() => {
      sdkCalls.fork += 1;
      return Effect.succeed(summary);
    });
    harness.setLoadSessionContextUsage(() => {
      sdkCalls.loadContext += 1;
      return Effect.succeed(null);
    });
    harness.setSendUserMessage(() => {
      sdkCalls.sendUserMessage += 1;
      return Effect.die("sendUserMessage should not be called");
    });
    const outsideWorkspaceInput = {
      ...startInput,
      workingDirectory: "/private",
    };
    const attempts = [
      harness.adapter.startSession(outsideWorkspaceInput).pipe(Effect.asVoid),
      harness.adapter
        .resumeSession({
          resumeMode: "reattach",
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .forkSession({
          ...outsideWorkspaceInput,
          parentExternalSessionId: "parent-session",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .loadContext({
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .sendUserMessage({
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
          parts: [{ kind: "text", text: "Start" }],
          delivery: "new_turn",
        })
        .pipe(Effect.asVoid),
    ];

    for (const attempt of attempts) {
      expect(await Effect.runPromise(Effect.result(attempt))).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "HostValidationError",
          field: "workingDirectory",
        },
      });
    }
    expect(sdkCalls).toEqual({
      start: 0,
      resume: 0,
      fork: 0,
      loadContext: 0,
      sendUserMessage: 0,
    });
  });

  test("keeps a no-message start idle after SDK initialization settles", async () => {
    const harness = await createHarness();
    harness.setStartSession(() =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:00.000Z",
          message: "Started build session",
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return summary;
      }),
    );

    await expect(
      Effect.runPromise(harness.adapter.startSession(startInput)),
    ).resolves.toMatchObject({
      externalSessionId: "session-1",
      status: "idle",
    });

    expect(
      await Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
    expect(transcriptEventTypes(harness.changes)).toEqual(["session_started"]);
  });

  test("keeps a no-message fork idle after SDK initialization settles", async () => {
    const harness = await createHarness();
    harness.setForkSession(() =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:00.000Z",
          message: "Forked build session",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:01.000Z",
        });
        return summary;
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.forkSession({
          ...startInput,
          parentExternalSessionId: "parent-session",
        }),
      ),
    ).resolves.toMatchObject({
      externalSessionId: "session-1",
      status: "idle",
    });

    const current = await Effect.runPromise(
      harness.adapter.readSnapshot({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    expect(current).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
    if (current.type !== "live") {
      throw new Error("Expected a live fork snapshot.");
    }
    expect(current.session.parentExternalSessionId).toBeUndefined();
  });

  test("publishes accepted input before draining its runtime response", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setSendUserMessage((input) =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:00.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "assistant_message",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:01.000Z",
          messageId: "assistant-1",
          message: "Done",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:02.000Z",
        });
        await Promise.resolve();
        return {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-17T10:01:59.000Z",
          messageId: "user-1",
          message: "Start",
          parts: [{ kind: "text" as const, text: "Start" }],
          state: "read" as const,
        };
      }),
    );

    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        delivery: "new_turn",
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Start" }],
      }),
    );

    expect(transcriptEventTypes(harness.changes)).toEqual([
      "user_message",
      "session_status",
      "assistant_message",
      "session_idle",
    ]);
  });

  test("reattaches live events when sending to a stopped session", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    await Effect.runPromise(
      harness.adapter.stopSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    harness.changes.splice(0);
    harness.setSendUserMessage((input) =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:00.000Z",
          message: "Resumed build session",
        });
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:01.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "assistant_message",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:02.000Z",
          messageId: "assistant-1",
          message: "Done",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:03.000Z",
        });
        return {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-17T10:01:59.000Z",
          messageId: "user-1",
          message: "Resume",
          parts: [{ kind: "text" as const, text: "Resume" }],
          state: "read" as const,
        };
      }),
    );

    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        delivery: "new_turn",
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Resume" }],
      }),
    );

    expect(harness.changes[0]).toMatchObject({
      type: "transcript_event",
      event: { type: "user_message" },
    });
    expect(transcriptEventTypes(harness.changes)).toEqual([
      "user_message",
      "session_started",
      "session_status",
      "assistant_message",
      "session_idle",
    ]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("keeps pending activity when an already-live session is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        resumeMode: "reattach",
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        pendingApprovals: [{ requestId: "approval-1" }],
      },
    });
  });

  test("keeps a current running session running when it is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      status: { type: "busy", message: null },
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        resumeMode: "reattach",
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "running" },
    });
  });

  test("keeps a current pending question intact when it is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        resumeMode: "reattach",
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_question",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ question: "Proceed?", header: "Decision" }],
          },
        ],
      },
    });
  });

  test("does not release an approval until its live resolution is published", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });
    const resolution = {
      event: {
        type: "approval_resolved",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:31.000Z",
        requestId: "approval-1",
      },
      complete: () => completed.push("approval-1"),
    } satisfies ClaudePendingInputResolution;
    harness.setPrepareApprovalReply(() => Effect.succeed(resolution));
    harness.failNextMutationAfterStateApply();

    await expect(
      Effect.runPromise(
        harness.adapter.replyApproval({
          ...startInput,
          externalSessionId: "session-1",
          requestId: "approval-1",
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("Publication failed.");

    expect(completed).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        pendingApprovals: [{ requestId: "approval-1" }],
      },
    });

    await Effect.runPromise(
      harness.adapter.replyApproval({
        ...startInput,
        externalSessionId: "session-1",
        requestId: "approval-1",
        outcome: "approve_once",
      }),
    );

    expect(completed).toEqual(["approval-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
  });

  test("does not release a question until its live resolution is published", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });
    const resolution = {
      event: {
        type: "question_resolved",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:31.000Z",
        requestId: "question-1",
      },
      complete: () => completed.push("question-1"),
    } satisfies ClaudePendingInputResolution;
    harness.setPrepareQuestionReply(() => Effect.succeed(resolution));
    harness.failNextMutationAfterStateApply();

    await expect(
      Effect.runPromise(
        harness.adapter.replyQuestion({
          ...startInput,
          externalSessionId: "session-1",
          requestId: "question-1",
          answers: [["Yes"]],
        }),
      ),
    ).rejects.toThrow("Publication failed.");

    expect(completed).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_question",
        pendingQuestions: [{ requestId: "question-1" }],
      },
    });

    await Effect.runPromise(
      harness.adapter.replyQuestion({
        ...startInput,
        externalSessionId: "session-1",
        requestId: "question-1",
        answers: [["Yes"]],
      }),
    );

    expect(completed).toEqual(["question-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingQuestions: [] },
    });
  });

  test("resolves a nested subagent approval through the root session", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });
    harness.setPrepareApprovalReply(() =>
      Effect.succeed({
        event: {
          type: "approval_resolved",
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
          childExternalSessionId,
          subagentCorrelationKey: "nested-agent",
          timestamp: "2026-07-17T10:01:31.000Z",
          requestId: "approval-1",
        },
        complete: () => completed.push("approval-1"),
      }),
    );

    await Effect.runPromise(
      harness.adapter.replyApproval({
        ...startInput,
        externalSessionId: childExternalSessionId,
        requestId: "approval-1",
        outcome: "approve_once",
      }),
    );

    expect(completed).toEqual(["approval-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: childExternalSessionId,
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
  });

  test("resolves a nested subagent question through the root session", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });
    harness.setPrepareQuestionReply(() =>
      Effect.succeed({
        event: {
          type: "question_resolved",
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
          childExternalSessionId,
          subagentCorrelationKey: "nested-agent",
          timestamp: "2026-07-17T10:01:31.000Z",
          requestId: "question-1",
        },
        complete: () => completed.push("question-1"),
      }),
    );

    await Effect.runPromise(
      harness.adapter.replyQuestion({
        ...startInput,
        externalSessionId: childExternalSessionId,
        requestId: "question-1",
        answers: [["Yes"]],
      }),
    );

    expect(completed).toEqual(["question-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: childExternalSessionId,
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingQuestions: [] },
    });
  });

  test("uses the SDK summary when resuming a session that is not loaded", async () => {
    const harness = await createHarness();
    harness.setResumeSession(() => Effect.succeed(summary));

    await Effect.runPromise(
      harness.adapter.resumeSession({
        resumeMode: "reattach",
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("lets a direct context read replace an older event queued before the read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setLoadSessionContextUsage(() =>
      Effect.succeed({ totalTokens: 120, contextWindow: 200 }),
    );
    const eventMutation = harness.pauseNextMutation();
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 99,
      contextWindow: 200,
    });
    await eventMutation.entered.promise;

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    eventMutation.release.resolve();

    await expect(loadPromise).resolves.toEqual({ totalTokens: 120, contextWindow: 200 });
  });

  test("keeps a context event that arrives during a direct read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    const readStarted = deferred<void>();
    const directRead = deferred<{ totalTokens: number; contextWindow: number }>();
    harness.setLoadSessionContextUsage(() =>
      Effect.promise(async () => {
        readStarted.resolve();
        return directRead.promise;
      }),
    );

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    await readStarted.promise;
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 130,
      contextWindow: 200,
    });
    directRead.resolve({ totalTokens: 120, contextWindow: 200 });

    await expect(loadPromise).resolves.toEqual({ totalTokens: 130, contextWindow: 200 });
  });

  test("keeps an equal-valued context event that arrives during a direct read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setLoadSessionContextUsage(() =>
      Effect.succeed({ totalTokens: 100, contextWindow: 200 }),
    );
    await Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    const readStarted = deferred<void>();
    const directRead = deferred<{ totalTokens: number; contextWindow: number }>();
    harness.setLoadSessionContextUsage(() =>
      Effect.promise(async () => {
        readStarted.resolve();
        return directRead.promise;
      }),
    );

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    await readStarted.promise;
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 100,
      contextWindow: 200,
    });
    directRead.resolve({ totalTokens: 120, contextWindow: 200 });

    await expect(loadPromise).resolves.toEqual({ totalTokens: 100, contextWindow: 200 });
  });

  test("publishes retractions but not status events buffered during release", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setReleaseSession(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          messageIds: ["queued-user-1"],
        });
      }),
    );

    await Effect.runPromise(
      harness.adapter.releaseSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    expect(harness.changes).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({
          type: "transcript_retracted",
          messageIds: ["queued-user-1"],
        }),
      },
      {
        type: "session_removed",
        ref: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
      },
    ]);
  });

  test("publishes queued-message retraction and finish before removing a stopped session", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setStopSession(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          messageIds: ["queued-user-1"],
        });
        harness.eventHub.emit(session, {
          type: "session_finished",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          message: "Session stopped",
        });
      }),
    );

    await Effect.runPromise(
      harness.adapter.stopSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    expect(transcriptEventTypes(harness.changes)).toEqual([
      "transcript_retracted",
      "session_finished",
    ]);
    expect(harness.changes.filter((change) => change.type === "session_removed")).toHaveLength(1);
  });

  test("retracts queued user messages while releasing the runtime", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setSendUserMessage((input) =>
      Effect.succeed({
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-17T10:02:00.000Z",
        messageId: "queued-user-1",
        message: "Queued",
        parts: [{ kind: "text", text: "Queued" }],
        state: "queued",
      }),
    );
    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        delivery: "new_turn",
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Queued" }],
      }),
    );
    harness.changes.splice(0);
    harness.setStopSessionsForRuntime(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          messageIds: ["queued-user-1"],
        });
        harness.eventHub.emit(session, {
          type: "session_finished",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          message: "Finished",
        });
      }),
    );

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).resolves.toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
    expect(transcriptEventTypes(harness.changes)).toEqual([
      "transcript_retracted",
      "session_finished",
    ]);
  });

  test("retains runtime state when cleanup fails so release can be retried", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    let cleanupAttempts = 0;
    let disposeCalls = 0;
    harness.setDispose(() => Effect.sync(() => void (disposeCalls += 1)));
    harness.setStopSessionsForRuntime(() => {
      cleanupAttempts += 1;
      return cleanupAttempts === 1
        ? Effect.fail(
            new HostOperationError({
              operation: "test.stop-sessions",
              message: "Claude cleanup failed.",
            }),
          )
        : Effect.void;
    });

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).rejects.toThrow(
      "Claude cleanup failed.",
    );
    expect(disposeCalls).toBe(0);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({ type: "live" });

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).resolves.toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
    expect(cleanupAttempts).toBe(2);
    expect(disposeCalls).toBe(1);
  });

  test("serializes live model updates in selection order", async () => {
    const harness = await createHarness();
    const startedModels: string[] = [];
    let releaseFirstUpdate: (() => void) | undefined;
    const firstUpdateReleased = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let markFirstUpdateStarted: (() => void) | undefined;
    const firstUpdateStarted = new Promise<void>((resolve) => {
      markFirstUpdateStarted = resolve;
    });
    harness.setUpdateSessionModel((input, runtimeId) =>
      Effect.promise(async () => {
        expect(runtimeId).toBe("runtime-1");
        expect(input.sessionScope).toEqual({ kind: "repository", workspaceId: "repo" });
        startedModels.push(input.model?.modelId ?? "default");
        if (startedModels.length === 1) {
          markFirstUpdateStarted?.();
          await firstUpdateReleased;
        }
      }),
    );
    const controlRef = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    const firstUpdate = Effect.runPromise(
      harness.adapter.updateSessionModel({
        ...controlRef,
        sessionScope: { kind: "repository", workspaceId: "repo" },
        model: {
          providerId: "claude",
          modelId: "claude-a",
        },
      }),
    );
    await firstUpdateStarted;
    const secondUpdate = Effect.runPromise(
      harness.adapter.updateSessionModel({
        ...controlRef,
        sessionScope: { kind: "repository", workspaceId: "repo" },
        model: {
          providerId: "claude",
          modelId: "claude-b",
        },
      }),
    );
    await Promise.resolve();

    expect(startedModels).toEqual(["claude-a"]);

    releaseFirstUpdate?.();
    await Promise.all([firstUpdate, secondUpdate]);
    expect(startedModels).toEqual(["claude-a", "claude-b"]);
  });

  test("delegates a live session title update to the Claude service", async () => {
    const harness = await createHarness();
    const calls: unknown[] = [];
    harness.setUpdateSessionTitle((input) =>
      Effect.sync(() => {
        calls.push(input);
        return {
          status: "renamed" as const,
          summary: {
            ...summary,
            title: input.title,
            sessionAssociation: {
              kind: "repository" as const,
              workspaceId: "repo",
              title: input.title,
            },
          },
        };
      }),
    );
    const controlRef = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      title: "Renamed",
    };

    await Effect.runPromise(harness.adapter.updateSessionTitle(controlRef));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      repoPath: "/repo",
      externalSessionId: "session-1",
      workingDirectory: "/repo/worktree",
      title: "Renamed",
    });
  });

  test("keeps the current activity when a title update runs", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      status: { type: "busy", message: null },
    });
    harness.setUpdateSessionTitle((input) =>
      Effect.succeed({
        status: "renamed" as const,
        summary: { ...summary, title: input.title },
      }),
    );

    await Effect.runPromise(
      harness.adapter.updateSessionTitle({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        title: "Renamed",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "running", title: "Renamed" },
    });
  });

  test("keeps the saved title when the runtime does not hold the session", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setUpdateSessionTitle(() => Effect.succeed({ status: "not_attached" as const }));
    harness.changes.length = 0;

    await expect(
      Effect.runPromise(
        harness.adapter.updateSessionTitle({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          title: "Renamed",
        }),
      ),
    ).resolves.toEqual({ status: "not_attached" });

    expect(harness.changes).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({ type: "live", session: { title: "Claude build" } });
  });

  test("keeps the saved title when the runtime rename fails", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setUpdateSessionTitle(() =>
      Effect.fail(new HostOperationError({ operation: "test.rename", message: "Rename failed." })),
    );
    harness.changes.length = 0;

    await expect(
      Effect.runPromise(
        harness.adapter.updateSessionTitle({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          title: "Renamed",
        }),
      ),
    ).rejects.toThrow("Rename failed.");

    expect(harness.changes).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({ type: "live", session: { title: "Claude build" } });
  });

  describe("with sessions from two repositories", () => {
    const startBothSessions = async (harness: Awaited<ReturnType<typeof createHarness>>) => {
      harness.setStartSession((input) =>
        Effect.succeed(input.repoPath === "/other-repo" ? otherSummary : summary),
      );
      await Effect.runPromise(harness.adapter.startSession(startInput));
      await Effect.runPromise(harness.adapter.startSession(otherStartInput));
    };

    test("lists the sessions of every repository from one runtime adapter", async () => {
      const harness = await createHarness();

      await startBothSessions(harness);

      const snapshots = await Effect.runPromise(harness.adapter.listSnapshots());
      expect(snapshots.map((snapshot) => snapshot.ref)).toEqual([sessionRef, otherSessionRef]);
      expect(
        harness.changes.flatMap((change) =>
          change.type === "session_upsert" ? [change.snapshot.ref] : [],
        ),
      ).toEqual([sessionRef, otherSessionRef]);
    });

    test("publishes runtime events with the repository of their session", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      harness.changes.splice(0);
      const catalog = { commands: [] };
      harness.setLoadSessionContextUsage(() => Effect.succeed(null));

      harness.eventHub.emit(otherSession, {
        type: "runtime_slash_commands_changed",
        externalSessionId: "session-2",
        timestamp: "2026-07-17T10:05:00.000Z",
        catalog,
      });
      await Effect.runPromise(
        harness.adapter.loadContext({
          ...otherSessionRef,
          sessionScope: { kind: "repository", workspaceId: "other-repo" },
        }),
      );

      expect(harness.changes).toContainEqual({
        type: "slash_command_catalog_updated",
        repoPath: "/other-repo",
        runtimeKind: "claude",
        workingDirectory: "/other-repo",
        catalog,
      });
    });

    test("reports an event projection fault to the repository of the session", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      harness.changes.splice(0);
      harness.failNextMutationAfterStateApply("session_started");

      harness.eventHub.emit(otherSession, {
        type: "session_started",
        externalSessionId: "session-2",
        timestamp: "2026-07-17T10:05:00.000Z",
        message: "Started",
      });
      harness.setLoadSessionContextUsage(() => Effect.succeed(null));
      await expect(
        Effect.runPromise(
          harness.adapter.loadContext({
            ...otherSessionRef,
            sessionScope: { kind: "repository", workspaceId: "other-repo" },
          }),
        ),
      ).rejects.toThrow("Publication failed.");

      expect(harness.changes).toEqual([
        {
          type: "fault",
          repoPath: "/other-repo",
          operation: "test.publish",
          message: "Publication failed.",
        },
      ]);
    });

    test("reports a title projection fault to the repository of the request", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      harness.setUpdateSessionTitle((input) =>
        Effect.succeed({
          status: "renamed" as const,
          summary: { ...otherSummary, title: input.title },
        }),
      );
      harness.changes.splice(0);
      harness.failNextMutationAfterStateApply();

      await expect(
        Effect.runPromise(
          harness.adapter.updateSessionTitle({ ...otherSessionRef, title: "Renamed" }),
        ),
      ).resolves.toEqual({ status: "renamed" });

      expect(harness.changes).toEqual([
        {
          type: "fault",
          repoPath: "/other-repo",
          operation: "claude-live-session.update-session-title",
          message: "Publication failed.",
        },
      ]);
    });

    test("retains an imported session under the repository of the import request", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      harness.setInspectSessionForImport(() =>
        Effect.succeed({
          metadata: {
            externalSessionId: "session-3",
            runtimeKind: "claude",
            workingDirectory: "/other-repo",
            title: "Imported",
            updatedAt: null,
          },
          selectedModel: null,
          attach: Effect.succeed({ ...otherSummary, externalSessionId: "session-3" }),
        }),
      );
      const importedRef = { ...otherSessionRef, externalSessionId: "session-3" };

      const source = await Effect.runPromise(
        harness.adapter.sessionImport.inspectSession({
          ...importedRef,
          sessionScope: { kind: "repository", workspaceId: "other-repo" },
        }),
      );
      await Effect.runPromise(source.attach);

      const snapshots = await Effect.runPromise(harness.adapter.listSnapshots());
      expect(snapshots.map((snapshot) => snapshot.ref)).toEqual([
        sessionRef,
        otherSessionRef,
        importedRef,
      ]);
    });

    test("removes only the session tree of a stopped session", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      const stopped: unknown[] = [];
      harness.setStopSession((input) =>
        Effect.sync(() => {
          stopped.push(input);
          harness.eventHub.emit(otherSession, {
            type: "session_finished",
            externalSessionId: "session-2",
            timestamp: "2026-07-17T10:06:00.000Z",
            message: "Session stopped",
          });
        }),
      );

      await Effect.runPromise(harness.adapter.stopSession(otherSessionRef));

      expect(stopped).toEqual([otherSessionRef]);
      const snapshots = await Effect.runPromise(harness.adapter.listSnapshots());
      expect(snapshots.map((snapshot) => snapshot.ref)).toEqual([sessionRef]);
    });

    test("releases the sessions of every repository and disposes the service", async () => {
      const harness = await createHarness();
      await startBothSessions(harness);
      const stoppedRuntimeIds: string[] = [];
      let disposeCalls = 0;
      harness.setStopSessionsForRuntime((runtimeId) =>
        Effect.sync(() => {
          stoppedRuntimeIds.push(runtimeId);
        }),
      );
      harness.setDispose(() => Effect.sync(() => void (disposeCalls += 1)));

      await expect(Effect.runPromise(harness.adapter.releaseRuntime())).resolves.toEqual([
        sessionRef,
        otherSessionRef,
      ]);

      expect(stoppedRuntimeIds).toEqual(["runtime-1"]);
      expect(disposeCalls).toBe(1);
      await expect(Effect.runPromise(harness.adapter.listSnapshots())).resolves.toEqual([]);
    });
  });
});

describe("Claude host live-session adapter goals", () => {
  const OBJECTIVE = "All tests pass";
  const setRecord = {
    type: "attachment",
    uuid: "g1",
    parentUuid: null,
    attachment: { type: "goal_status", met: false, sentinel: true, condition: OBJECTIVE },
  };
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const goalHarness = async (records: object[] = []) => {
    const configDirectory = await mkdtemp(join(tmpdir(), "claude-goal-adapter-"));
    directories.push(configDirectory);
    const projectDirectory = join(configDirectory, "projects", "-repo");
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, `${session.externalSessionId}.jsonl`);
    await writeFile(transcript, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    const { goalTracking: _sharedTracking, ...base } = session;
    const goalSession: ClaudeSessionContext = {
      ...base,
      acceptedUserMessages: [],
      transcriptEnvironment: { CLAUDE_CONFIG_DIR: configDirectory },
    };
    const harness = await createHarness(workingDirectoryDependencies, {
      get: (externalSessionId) =>
        externalSessionId === goalSession.externalSessionId ? goalSession : undefined,
      isLatest: (candidate) => candidate === goalSession,
    });
    harness.setStartSession(() => Effect.succeed(summary));
    harness.setLoadSessionContextUsage(() => Effect.succeed(null));
    const sent: Parameters<ClaudeAgentSdkService["sendUserMessage"]>[0][] = [];
    const observe = (frame: ClaudeProtocolObject) =>
      observeClaudeGoalFrame({
        session: goalSession,
        // SAFETY: The observer reads frames through its own schemas, like live SDK frames.
        message: frame as SDKMessage,
        now: () => "2026-11-07T10:00:01.000Z",
        emit: (event) => harness.eventHub.emit(goalSession, event),
        onFailure: () => {},
      });
    const reply = (args: string, text: string) =>
      observe({
        type: "assistant",
        parent_tool_use_id: null,
        local_command_run: { command: "goal", args },
        message: { model: "<synthetic>", content: [{ type: "text", text }] },
      });
    const accept = (messageId: string, text: string) =>
      Effect.succeed({
        type: "user_message" as const,
        externalSessionId: session.externalSessionId,
        timestamp: "2026-11-07T10:00:00.000Z",
        messageId,
        message: text,
        parts: [{ kind: "text" as const, text }],
        state: "read" as const,
      });
    const snapshotGoal = async () => {
      await Effect.runPromise(harness.adapter.loadContext(sessionRef));
      const snapshots = await Effect.runPromise(harness.adapter.listSnapshots());
      return snapshots[0]?.goal;
    };
    return { harness, goalSession, sent, reply, observe, accept, snapshotGoal, transcript };
  };

  const goalInput = (command: AgentSessionGoalCommand) => ({
    ...sessionRef,
    sessionScope: startInput.sessionScope,
    command,
  });

  test("refuses to pause a goal", async () => {
    const { harness } = await goalHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    const result = await Effect.runPromise(
      Effect.result(harness.adapter.controlGoal(goalInput({ kind: "pause" }))),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure.message).toBe("Claude cannot pause a goal.");
  });

  test("returns a refused goal input once, with no unhandled rejection", async () => {
    const { harness } = await goalHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setSendUserMessage(() =>
      Effect.fail(new HostOperationError({ operation: "native", message: "Native input refused" })),
    );
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await Effect.runPromise(
        Effect.result(
          harness.adapter.controlGoal(goalInput({ kind: "set", objective: OBJECTIVE })),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure.message).toContain("Native input refused");
      expect(unhandled).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("restores the goal of a resumed session as waiting for a message", async () => {
    const { harness, snapshotGoal } = await goalHarness([
      { type: "user", uuid: "u0", parentUuid: null, message: { content: "Hi" } },
      { ...setRecord, parentUuid: "u0" },
    ]);
    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        resumeMode: "reattach",
        externalSessionId: "session-1",
      }),
    );
    expect(await snapshotGoal()).toEqual({ objective: OBJECTIVE, status: "waiting_for_message" });
  });

  test("clears the goal with /goal clear and removes it at the command reply", async () => {
    const { harness, sent, reply, accept, snapshotGoal } = await goalHarness([setRecord]);
    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        resumeMode: "reattach",
        externalSessionId: "session-1",
      }),
    );
    expect(await snapshotGoal()).toMatchObject({ objective: OBJECTIVE });
    harness.setSendUserMessage((input) => {
      sent.push(input);
      setTimeout(() => reply("clear", `Goal cleared: ${OBJECTIVE}`), 0);
      return accept("clear-1", "/goal clear");
    });
    await expect(
      Effect.runPromise(harness.adapter.controlGoal(goalInput({ kind: "clear" }))),
    ).resolves.toEqual({ type: "command_accepted", commandName: "goal" });
    expect(sent).toMatchObject([
      {
        delivery: "new_turn",
        parts: [
          { kind: "slash_command", command: { trigger: "goal" } },
          { kind: "text", text: " clear" },
        ],
      },
    ]);
    expect(await snapshotGoal()).toBeUndefined();
  });

  test("removes an ended goal without a native command", async () => {
    const { harness, goalSession, snapshotGoal, observe, transcript } = await goalHarness([
      setRecord,
    ]);
    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        resumeMode: "reattach",
        externalSessionId: "session-1",
      }),
    );
    await appendFile(
      transcript,
      `${JSON.stringify({ ...setRecord, uuid: "g2", parentUuid: "g1", attachment: { type: "goal_status", met: true, condition: OBJECTIVE } })}\n`,
    );
    observe({ type: "result", subtype: "success" });
    await goalSession.goalTracking?.reads;
    expect(await snapshotGoal()).toEqual({ objective: OBJECTIVE, status: "complete" });
    harness.setSendUserMessage(() => Effect.die("Claude needs no command for an ended goal."));
    await Effect.runPromise(harness.adapter.controlGoal(goalInput({ kind: "clear" })));
    expect(await snapshotGoal()).toBeUndefined();
  });

  test("sets the goal before the first message of a launch", async () => {
    const { harness, sent, reply, observe, accept, transcript, snapshotGoal } = await goalHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setSendUserMessage((input) => {
      sent.push(input);
      if (sent.length === 1) {
        setTimeout(async () => {
          reply(OBJECTIVE, `Goal set: ${OBJECTIVE}`);
          await appendFile(transcript, `${JSON.stringify(setRecord)}\n`);
          observe({ type: "assistant", parent_tool_use_id: null, message: { content: [] } });
        }, 0);
        return accept("goal-1", `/goal ${OBJECTIVE}`);
      }
      return accept("message-1", "Start the build");
    });
    const accepted = await Effect.runPromise(
      harness.adapter.sendUserMessage(
        {
          ...sessionRef,
          sessionScope: startInput.sessionScope,
          delivery: "new_turn",
          parts: [{ kind: "text", text: "Start the build" }],
          submissionId: "submission-1",
        },
        { goal: { objective: OBJECTIVE } },
      ),
    );
    expect(accepted).toMatchObject({ messageId: "message-1" });
    expect(sent.map((input) => input.parts.at(-1))).toEqual([
      { kind: "text", text: ` ${OBJECTIVE}` },
      { kind: "text", text: "Start the build" },
    ]);
    expect(sent[0]?.submissionId).toBeUndefined();
    expect(sent[1]?.submissionId).toBe("submission-1");
    expect(await snapshotGoal()).toEqual({ objective: OBJECTIVE, status: "waiting_for_message" });
  });
});
