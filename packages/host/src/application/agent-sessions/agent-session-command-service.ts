import { createSessionCreationPreparation } from "./session-creation-preparation";
import { createSessionModelPreparation } from "./session-model-preparation";
import type {
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  AgentSessionWorkflowScope,
  AgentMessageTarget,
  AgentSessionResumeIntent,
} from "@openducktor/contracts";
import { isAgentSessionBlockedOnInput, BLOCKED_ON_INPUT_REASON } from "@openducktor/core";
import { Effect } from "effect";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import type {
  AgentSessionOperationPolicy,
  AgentSessionSendContent,
} from "./agent-session-operation-policy";
import { createTaskWorkflowSessionPolicy } from "./task-workflow-session-policy";
import { resumeAndSaveSession } from "./session-resume";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import { createSessionOperationOwner } from "./session-operation-owner";
import { resolveOwnedSessionRoot } from "./session-owner-resolution";
import type { createSessionTurnPreparation } from "./session-turn-preparation";

type ObservedSessionCommands = Pick<
  AgentSessionLiveStateService,
  "continueInterruptedTurn" | "loadContext" | "loadSessionDiff" | "replyApproval" | "replyQuestion"
>;

export const createAgentSessionCommandService = ({
  repositoryPolicy,
  pauseForStop,
  turnPreparation,
  readSessionRootRefs,
  approvalPolicy,
  ...dependencies
}: Omit<Parameters<typeof createTaskWorkflowSessionPolicy>[0], "resolveRoot"> & {
  repositoryPolicy: AgentSessionOperationPolicy;
  pauseForStop: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  turnPreparation: ReturnType<typeof createSessionTurnPreparation>;
  readSessionRootRefs: (
    repoPath: string,
  ) => Effect.Effect<import("@openducktor/contracts").AgentSessionAuthorizedRoot[], HostError>;
  approvalPolicy: Pick<
    ReturnType<typeof import("./host-approval-policy").createHostApprovalPolicy>,
    "reply"
  >;
  runtime: Parameters<typeof createTaskWorkflowSessionPolicy>[0]["runtime"] &
    ObservedSessionCommands &
    Pick<AgentSessionLiveStateService, "read" | "list" | "publishOperation" | "retainOperation">;
}) => {
  const { runtime, canonicalizeRepoPath } = dependencies;
  const creation = createSessionCreationPreparation({
    runtime,
    turnPreparation,
    resolveRoot: (ref) => owner.root(ref),
    policyFor: (scope) => policyFor(scope),
  });
  const workflow = createTaskWorkflowSessionPolicy({
    ...dependencies,
    runtime: {
      ...runtime,
      ...creation,
    },
    resolveRoot: (ref) => owner.root(ref),
  });
  const policyFor = (scope: { kind: "repository" } | AgentSessionWorkflowScope) =>
    scope.kind === "workflow" ? workflow.forScope(scope) : repositoryPolicy;
  const owner = createSessionOperationOwner({
    resolveRoot: (ref) =>
      Effect.gen(function* () {
        const roots = yield* readSessionRootRefs(ref.repoPath);
        const sessions = yield* runtime.list({ repoPath: ref.repoPath });
        return yield* resolveOwnedSessionRoot({ ref, roots, sessions });
      }),
    policyFor: (target) => policyFor(target.sessionScope),
    publish: runtime.publishOperation,
    retain: runtime.retainOperation,
  });
  const readAvailableSession = (ref: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const { repoPath, runtimeKind, workingDirectory, externalSessionId } = ref;
      const live = yield* runtime.read({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      });
      if (live.type === "live" && live.session.statusUnavailableReason)
        return yield* new HostOperationError({
          operation: "session.prepare",
          message: live.session.statusUnavailableReason,
        });
      return live;
    });
  const checkPending = (ref: AgentSessionLiveRef) =>
    readAvailableSession(ref).pipe(
      Effect.flatMap((live) => {
        if (live.type === "live" && isAgentSessionBlockedOnInput(live.session))
          return new HostOperationError({
            operation: "session.prepare",
            message: BLOCKED_ON_INPUT_REASON,
          });
        return Effect.succeed(live);
      }),
    );
  const {
    continuationModel,
    updateModel,
    waitForIdle,
    observe: observeModelUpdate,
    cancel: cancelModelUpdate,
  } = createSessionModelPreparation({
    owner,
    runtime,
    turnPreparation,
  });
  const requireReadySession = (ref: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const live = yield* checkPending(ref);
      if (live.type !== "live")
        return yield* new HostValidationError({
          field: "externalSessionId",
          message: "The session is not attached to its runtime. Reopen the chat before sending.",
        });
      return live;
    });

  return {
    ...runtime,
    runMessageOperation: <A, E>(
      input: AgentMessageTarget,
      effect: Effect.Effect<A, E>,
      submissionId?: string,
    ) =>
      owner.supervise(
        Effect.gen(function* () {
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          return yield* owner.run({ ...input, repoPath }, "submission", effect, submissionId);
        }),
      ),
    shutdownOperations: owner.shutdown,
    observeOperation: (envelope: import("@openducktor/contracts").AgentSessionLiveEnvelope) =>
      Effect.sync(() => observeModelUpdate(envelope)).pipe(
        Effect.andThen(
          Effect.forEach(
            envelope.type === "snapshot"
              ? envelope.sessions.map((session) => ({ type: "session_upsert" as const, session }))
              : [envelope],
            (value) => {
              const observation = owner.observe(value);
              return observation
                ? runtime.publishOperation({ type: "session_operation_updated", observation })
                : Effect.void;
            },
            { discard: true },
          ),
        ),
      ),
    commitQueueResume: owner.commit,
    prepareQueueResume: (input: AgentSessionSendContent) =>
      owner.run(
        input,
        "submission",
        Effect.gen(function* () {
          yield* requireReadySession(input);
          yield* policyFor(input.sessionScope).validateRef(input);
        }),
      ),
    prepareSessionCreation: creation,
    startSession: (input: Parameters<typeof runtime.startSession>[0]) =>
      owner.supervise(creation.startSession(input)),
    startWorkflowSession: (input: Parameters<typeof workflow.startWorkflowSession>[0]) =>
      owner.supervise(workflow.startWorkflowSession(input)),
    forkSession: (input: Parameters<typeof workflow.forkSession>[0]) =>
      owner.supervise(
        Effect.gen(function* () {
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          if (!input.workingDirectory)
            return yield* new HostValidationError({
              field: "workingDirectory",
              message: "Select the owned checkout before forking.",
            });
          const parent = {
            repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.parentExternalSessionId,
          };
          const root = yield* owner.root(parent);
          const work = workflow.forkSession({
            ...input,
            repoPath,
            workStartGuard: owner.captureGuard(parent),
          });
          return yield* root.sessionScope.kind === "repository"
            ? policyFor(root.sessionScope).run(parent, "fork session", work)
            : work;
        }),
      ),
    loadContext: (input: Parameters<typeof runtime.loadContext>[0]) =>
      repositoryPolicy.run(
        input,
        "load session context",
        owner.root(input).pipe(Effect.andThen(runtime.loadContext(input))),
      ),
    loadSessionDiff: (input: Parameters<typeof runtime.loadSessionDiff>[0]) =>
      repositoryPolicy.run(
        input,
        "load session diff",
        owner.root(input).pipe(Effect.andThen(runtime.loadSessionDiff(input))),
      ),
    replyApproval: approvalPolicy.reply,
    replyQuestion: (input: Parameters<typeof runtime.replyQuestion>[0]) =>
      owner.supervise(
        Effect.gen(function* () {
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          const ref = { ...input, repoPath };
          const root = yield* owner.root(ref);
          return yield* policyFor(root.sessionScope).run(
            ref,
            "reply to question",
            runtime.replyQuestion(ref),
          );
        }),
      ),
    stopSession: (
      input: Parameters<typeof runtime.stopSession>[0],
      options?: { onValidated: (ref: AgentSessionLiveRef) => void },
    ) =>
      owner.supervise(
        Effect.gen(function* () {
          const repoPath = yield* canonicalizeRepoPath(input.repoPath);
          const ref = { ...input, repoPath };
          const root = yield* owner.root(ref);
          owner.cancel(ref);
          cancelModelUpdate(ref);
          options?.onValidated(ref);
          yield* pauseForStop(ref);
          return yield* owner.run(
            { ...ref, sessionScope: root.sessionScope },
            "stop",
            runtime.stopSession(ref).pipe(
              Effect.tap(() => owner.controlAccepted()),
              Effect.andThen(owner.requireStopSettled(ref)),
            ),
          );
        }),
      ),
    releaseSession: (input: Parameters<typeof runtime.releaseSession>[0]) =>
      repositoryPolicy.run(input, "release session", runtime.releaseSession(input)),
    resumeSession: (
      input: AgentSessionResumeIntent & import("@openducktor/core").AgentWorkStartOptions,
    ) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        const continuesTurn = input.resumeMode === "continue_interrupted_turn";
        return yield* owner.run(
          ref,
          continuesTurn ? "continue" : "reattach",
          Effect.gen(function* () {
            const live = yield* continuesTurn ? checkPending(ref) : readAvailableSession(ref);
            const prepared = yield* policy.prepareResume(ref);
            let model = prepared.input.model;
            let systemPrompt = prepared.input.systemPrompt;
            if (continuesTurn) {
              model =
                (yield* continuationModel(
                  prepared.input,
                  live.type === "live" ? live.session : undefined,
                )) ?? undefined;
              systemPrompt = (yield* turnPreparation.context(ref)) ?? systemPrompt;
            }
            const runtimeInput = {
              ...prepared.input,
              model,
              systemPrompt,
            };
            if (continuesTurn) {
              const { resumeMode: _resumeMode, ...continuationInput } = runtimeInput;
              const options = yield* owner.options();
              yield* Effect.try({
                try: () => options.assertCurrent?.(),
                catch: (cause) => toHostOperationError(cause, "session.continue"),
              });
              yield* checkPending(ref);
              const continued = yield* runtime.continueInterruptedTurn({
                ...continuationInput,
                workStartGuard: options.assertCurrent
                  ? { assertCurrent: options.assertCurrent }
                  : undefined,
                onWorkIssued: options.onSent,
                onWorkAccepted: options.onAccepted,
              });
              yield* owner.controlAccepted();
              return continued;
            }
            const resumeOptions = yield* owner.options("reattach");
            return yield* resumeAndSaveSession({
              ref,
              resume: runtime.resumeSession({
                ...runtimeInput,
                workStartGuard: resumeOptions.assertCurrent
                  ? { assertCurrent: resumeOptions.assertCurrent }
                  : undefined,
                onWorkIssued: resumeOptions.onSent,
                onWorkAccepted: resumeOptions.onAccepted,
              }),
              save: prepared.save,
              release: runtime.releaseSession,
            }).pipe(
              Effect.tap(() => owner.reattached()),
              Effect.map(({ session }) => session),
            );
          }),
          undefined,
          input.workStartGuard?.assertCurrent,
        );
      }),
    prepareUserMessage: (input: AgentSessionSendContent) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* owner.run(
          ref,
          "submission",
          Effect.gen(function* () {
            yield* requireReadySession(ref);
            return yield* policy.prepareSend(ref);
          }),
          input.submissionId,
        );
      }),
    sendUserMessage: (
      input: AgentSessionControlSendInput,
      options?: Parameters<typeof runtime.sendUserMessage>[1],
    ) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* owner.run(
          ref,
          "submission",
          Effect.gen(function* () {
            const live = yield* requireReadySession(ref);
            const steering =
              input.delivery === "steer" &&
              live.type === "live" &&
              (live.session.activity === "running" || live.session.activity === "retrying");
            const content = yield* policy.prepareSend(ref);
            const systemPrompt = steering ? undefined : yield* turnPreparation.context(ref);
            const current = yield* checkPending(ref);
            if (
              steering &&
              (current.type !== "live" ||
                !["running", "retrying"].includes(current.session.activity))
            )
              return yield* new HostOperationError({
                operation: "session.steer",
                message:
                  "The running turn ended before steering. Send a new message with current context.",
              });
            const request: AgentSessionControlSendInput = {
              ...content,
              delivery: steering ? ("steer" as const) : ("new_turn" as const),
              systemPrompt: steering ? undefined : (systemPrompt ?? content.systemPrompt),
            };
            if (ref.sessionScope.kind === "workflow" && !steering && current.type === "live") {
              const questionIds = current.session.pendingQuestions
                .filter((question) => question.blocking === false)
                .map((question) => question.requestId);
              if (questionIds.length > 0) request.resolvedQuestionRequestIds = questionIds;
            }
            const guarded = yield* owner.options();
            const accepted = yield* runtime.sendUserMessage(request, {
              assertCurrent: guarded.assertCurrent,
              onSent: () => {
                guarded.onSent();
                options?.onSent?.();
              },
            });
            yield* owner
              .accepted(accepted)
              .pipe(Effect.mapError(messageAcceptedFailure(ref, accepted, "record_message")));
            if (accepted.type === "command_accepted") return accepted;
            yield* policy
              .recordAcceptedMessage(ref, accepted)
              .pipe(Effect.mapError(messageAcceptedFailure(ref, accepted, "record_message")));
            return accepted;
          }),
          input.submissionId,
          options?.assertCurrent,
        );
      }),
    updateSessionModel: (input: Parameters<typeof runtime.updateSessionModel>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* owner.run(
          ref,
          "model",
          Effect.gen(function* () {
            yield* checkPending(ref);
            yield* waitForIdle(ref);
            yield* policy.run(
              ref,
              "model",
              Effect.gen(function* () {
                yield* checkPending(ref);
                const prepared = yield* policy.prepareModelUpdate(ref);
                if (input.model)
                  yield* turnPreparation.model(
                    ref,
                    {
                      ...input.model,
                      profileId: input.model.profileId ?? prepared.previousModel?.profileId,
                      runtimeKind: input.runtimeKind,
                    },
                    prepared.previousModel
                      ? { ...prepared.previousModel, runtimeKind: input.runtimeKind }
                      : null,
                  );
                yield* updateModel(prepared);
              }),
            );
          }),
          undefined,
          input.workStartGuard?.assertCurrent,
        );
      }),
  };
};
