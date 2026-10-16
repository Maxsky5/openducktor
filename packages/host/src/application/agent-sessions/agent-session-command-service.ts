import { createSessionCreationPreparation } from "./session-creation-preparation";
import { createSessionModelPreparation } from "./session-model-preparation";
import type {
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  AgentSessionWorkflowScope,
  AgentMessageTarget,
  AgentSessionResumeIntent,
} from "@openducktor/contracts";
import {
  agentSessionRefKey,
  isAgentSessionBlockedOnInput,
  isSameSelection,
  BLOCKED_ON_INPUT_REASON,
} from "@openducktor/core";
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
  const checkPending = (ref: AgentSessionLiveRef) =>
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
      if (live.type === "live" && isAgentSessionBlockedOnInput(live.session))
        return yield* new HostOperationError({
          operation: "session.prepare",
          message: BLOCKED_ON_INPUT_REASON,
        });
      return live;
    });
  const { prepareModel, prepareContinuationModel, updateModel } = createSessionModelPreparation({
    owner,
    runtime,
    turnPreparation,
  });
  const selectMessageModel = (
    input: AgentSessionSendContent,
    prepared: AgentSessionSendContent,
    live: Effect.Success<ReturnType<typeof checkPending>>,
    steering = false,
  ) =>
    Effect.gen(function* () {
      const root = yield* owner.root(input);
      if (input.modelCaptured) prepared = { ...prepared, model: input.model, modelCaptured: true };
      else if (root.externalSessionId !== input.externalSessionId && live.type === "live")
        prepared = { ...prepared, model: live.session.model ?? undefined, modelCaptured: true };
      return yield* prepareModel(prepared, policyFor(input.sessionScope), steering);
    });
  const prepareDelivery = (
    input: AgentSessionSendContent,
    live: Effect.Success<ReturnType<typeof checkPending>>,
    steering = false,
  ) =>
    Effect.gen(function* () {
      const policy = policyFor(input.sessionScope);
      const prepared = yield* policy.prepareSend(input);
      const selected = yield* selectMessageModel(input, prepared, live, steering);
      const systemPrompt = steering ? undefined : yield* turnPreparation.context(input);
      if (!steering && live.type === "missing") {
        const resume = yield* policy.prepareResume({ ...input, resumeMode: "reattach" });
        const guard = yield* owner.options("reattach");
        const resumed = yield* resumeAndSaveSession({
          ref: input,
          resume: runtime.resumeSession({
            ...resume.input,
            model: selected.model,
            systemPrompt: systemPrompt ?? resume.input.systemPrompt,
            workStartGuard: guard.assertCurrent
              ? { assertCurrent: guard.assertCurrent }
              : undefined,
            onWorkIssued: guard.onSent,
            onWorkAccepted: guard.onAccepted,
          }),
          save: resume.save,
          release: runtime.releaseSession,
        });
        if (agentSessionRefKey({ ...input, ...resumed.session }) !== agentSessionRefKey(input))
          return yield* new HostOperationError({
            operation: "session.reattach",
            message: "The runtime reattached a different session. No message was sent.",
          });
        yield* owner.reattached();
      }
      return {
        content: {
          ...selected,
          systemPrompt: steering ? undefined : (systemPrompt ?? selected.systemPrompt),
        },
        saveModel: !steering && isSameSelection(selected.model, prepared.model),
      };
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
    commitQueueResume: owner.commit,
    prepareQueueResume: (input: AgentSessionSendContent) =>
      owner.run(
        input,
        "submission",
        Effect.gen(function* () {
          const live = yield* checkPending(input);
          yield* prepareDelivery({ ...input, modelCaptured: true }, live);
          yield* checkPending(input);
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
        return yield* owner.run(
          ref,
          input.resumeMode === "continue_interrupted_turn" ? "continue" : "reattach",
          Effect.gen(function* () {
            const live = yield* checkPending(ref);
            const prepared = yield* policy.prepareResume(ref);
            const model =
              input.resumeMode === "continue_interrupted_turn"
                ? yield* prepareContinuationModel(
                    prepared.input,
                    live.type === "live" ? live.session : undefined,
                  )
                : prepared.input;
            const systemPrompt =
              input.resumeMode === "continue_interrupted_turn"
                ? yield* turnPreparation.context(ref)
                : undefined;
            const runtimeInput = {
              ...prepared.input,
              model: model.model,
              systemPrompt: systemPrompt ?? prepared.input.systemPrompt,
            };
            if (input.resumeMode === "continue_interrupted_turn") {
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
    prepareUserMessage: (input: AgentSessionSendContent, options?: { steering: boolean }) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* owner.run(
          ref,
          "submission",
          Effect.gen(function* () {
            const prepared = yield* policy.prepareSend(ref);
            const live = yield* checkPending(ref);
            return yield* selectMessageModel(ref, prepared, live, options?.steering);
          }),
          input.submissionId,
        );
      }),
    sendUserMessage: (
      input: AgentSessionControlSendInput & { modelCaptured?: true },
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
            const live = yield* checkPending(ref);
            const steering =
              input.delivery === "steer" &&
              live.type === "live" &&
              (live.session.activity === "running" || live.session.activity === "retrying");
            const { content: selected, saveModel } = yield* prepareDelivery(ref, live, steering);
            const { modelCaptured: _captured, ...content } = selected;
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
            const request = {
              ...content,
              model: steering ? undefined : content.model,
              delivery: steering ? ("steer" as const) : ("new_turn" as const),
              systemPrompt: content.systemPrompt,
            };
            const guarded = yield* owner.options();
            const modelGuard = yield* owner.options("model");
            const accepted = yield* runtime.sendUserMessage(request, {
              assertCurrent: guarded.assertCurrent,
              onModelIssued: modelGuard.onSent,
              onModelAccepted: modelGuard.onAccepted,
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
              .recordAcceptedMessage(ref, accepted, { saveModel })
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
            const prepared = yield* policy.prepareModelUpdate(ref);
            if (input.model)
              yield* turnPreparation.model(
                ref,
                {
                  ...input.model,
                  profileId: input.model.profileId ?? prepared.previousModel?.profileId,
                  runtimeKind: input.runtimeKind,
                },
                {
                  captured: true,
                  previous: prepared.previousModel
                    ? { ...prepared.previousModel, runtimeKind: input.runtimeKind }
                    : null,
                },
              );
            yield* updateModel(prepared);
          }),
        );
      }),
  };
};
