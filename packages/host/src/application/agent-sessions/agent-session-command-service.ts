import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionWorkflowScope,
  type AgentSessionControlUpdateSpeedInput,
} from "@openducktor/contracts";
import { speedEligibility, initialSpeedState } from "@openducktor/core";
import { Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  AgentSessionMessageAcceptedError,
  messageSubmissionRejected,
} from "../../ports/agent-session-send-error";
import type {
  AgentSessionOperationPolicy,
  PreparedSessionModelUpdate,
} from "./agent-session-operation-policy";
import { prepareSavedSpeed } from "./agent-session-speed-preparation";
import { changeSessionSettings } from "./agent-session-settings-change";
import { createTaskWorkflowSessionPolicy } from "./task-workflow-session-policy";
import { resumeAndSaveSession } from "./session-resume";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

type ObservedSessionCommands = Pick<
  AgentSessionLiveStateService,
  "continueInterruptedTurn" | "loadContext" | "loadSessionDiff" | "replyApproval" | "replyQuestion"
>;

export const createAgentSessionCommandService = ({
  repositoryPolicy,
  ...dependencies
}: Parameters<typeof createTaskWorkflowSessionPolicy>[0] & {
  repositoryPolicy: AgentSessionOperationPolicy;
  runtime: Parameters<typeof createTaskWorkflowSessionPolicy>[0]["runtime"] &
    ObservedSessionCommands;
}) => {
  const { runtime, canonicalizeRepoPath } = dependencies;
  const workflow = createTaskWorkflowSessionPolicy(dependencies);
  const policyFor = (scope: { kind: "repository" } | AgentSessionWorkflowScope) =>
    scope.kind === "workflow" ? workflow.forScope(scope) : repositoryPolicy;

  const updateModel = (prepared: PreparedSessionModelUpdate) => {
    const ref = { ...prepared.input, speed: prepared.previousSpeed ?? "standard" };
    const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[ref.runtimeKind];
    if (descriptor.capabilities.speed.support === "none") {
      return Effect.uninterruptible(
        Effect.gen(function* () {
          yield* runtime.updateSessionModel(prepared.input);
          const saved = yield* Effect.result(prepared.save());
          if (saved._tag === "Success") return yield* saved.success;
          const restored = yield* Effect.result(
            runtime.updateSessionModel({ ...prepared.input, model: prepared.previousModel }),
          );
          if (restored._tag === "Failure")
            return yield* new HostOperationError({
              operation: "agent-session.update-model",
              message: `${saved.failure.message} Runtime model restore failed: ${restored.failure.message}`,
              cause: { storeFailure: saved.failure, restoreFailure: restored.failure },
            });
          return yield* Effect.fail(saved.failure);
        }),
      );
    }
    const settings = { ...ref, model: prepared.previousModel ?? undefined };
    return runtime.withSessionSettings(settings, (adapter) =>
      Effect.gen(function* () {
        const read = yield* adapter.readSnapshot(ref);
        const previousModel =
          read.type === "live" && read.session.model ? read.session.model : prepared.previousModel;
        const previous =
          read.type === "live" && read.session.speed
            ? read.session.speed
            : initialSpeedState(prepared.previousSpeed);
        const catalog = yield* adapter.queries
          .loadRuntimeCatalog({ ...ref })
          .pipe(
            Effect.mapError((cause) =>
              toHostOperationError(cause, "agent-session.read-speed-model"),
            ),
          );
        if (!catalog.models)
          return yield* new HostValidationError({
            field: "model",
            message:
              "This runtime did not report its model catalog. Refresh the model list before changing settings.",
          });
        if (catalog.models.status === "failed")
          return yield* toHostOperationError(
            catalog.models.cause,
            "agent-session.read-speed-model",
          );
        const eligibility = speedEligibility(
          descriptor,
          catalog.models.catalog,
          prepared.input.model,
          previous.choice ?? "standard",
        );
        const choice = eligibility === "unsupported" ? "standard" : previous.choice;
        if (choice !== null && choice !== "standard" && eligibility !== "supported")
          return yield* new HostValidationError({
            field: "model",
            message:
              "Speed support for this model is unknown. Refresh the model list or select Standard first.",
          });
        const retainedState =
          previous.synchronization === "confirmed" && previous.choice === choice
            ? previous
            : undefined;
        const apply = adapter
          .updateSessionModel(prepared.input)
          .pipe(
            Effect.andThen(
              choice === null
                ? Effect.succeed({})
                : adapter.updateSessionSpeed({ ...ref, speed: choice }, retainedState),
            ),
          );
        const restore = adapter
          .updateSessionModel({ ...prepared.input, model: previousModel })
          .pipe(
            Effect.andThen(
              previous.choice === null
                ? Effect.succeed({})
                : adapter.updateSessionSpeed({ ...ref, speed: previous.choice }, retainedState),
            ),
          );
        yield* changeSessionSettings({
          adapter,
          ref,
          previous,
          choice,
          apply,
          restore,
          save: prepared.save(choice),
        });
      }),
    );
  };

  const updateSessionSpeed = (input: AgentSessionControlUpdateSpeedInput) =>
    Effect.gen(function* () {
      const repoPath = yield* canonicalizeRepoPath(input.repoPath);
      const ref = { ...input, repoPath };
      const policy = policyFor(input.sessionScope);
      return yield* policy.run(
        ref,
        "change session speed",
        Effect.gen(function* () {
          const prepared = yield* policy.prepareSpeedUpdate(ref);
          const settings = { ...ref, model: prepared.model ?? undefined };
          return yield* runtime.withSessionSettings(settings, (adapter) =>
            Effect.gen(function* () {
              const read = yield* adapter.readSnapshot(ref);
              const previous =
                read.type === "live" && read.session.speed
                  ? read.session.speed
                  : initialSpeedState(prepared.choice);
              return yield* changeSessionSettings({
                adapter,
                ref,
                previous,
                choice: ref.speed,
                apply: adapter.updateSessionSpeed(ref),
                restore:
                  previous.choice === null
                    ? Effect.succeed({})
                    : adapter.updateSessionSpeed({ ...ref, speed: previous.choice }),
                save: prepared.save(
                  ref.speed,
                  read.type === "live" ? read.session.model : undefined,
                ),
              });
            }),
          );
        }),
      );
    });

  return {
    ...runtime,
    updateSessionSpeed,
    startWorkflowSession: workflow.startWorkflowSession,
    forkSession: workflow.forkSession,
    loadContext: (input: Parameters<typeof runtime.loadContext>[0]) =>
      repositoryPolicy.run(
        input,
        "load session context",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.loadContext(input))),
      ),
    loadSessionDiff: (input: Parameters<typeof runtime.loadSessionDiff>[0]) =>
      repositoryPolicy.run(
        input,
        "load session diff",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.loadSessionDiff(input))),
      ),
    replyApproval: (input: Parameters<typeof runtime.replyApproval>[0]) =>
      repositoryPolicy.run(
        input,
        "reply to approval",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.replyApproval(input))),
      ),
    replyQuestion: (input: Parameters<typeof runtime.replyQuestion>[0]) =>
      repositoryPolicy.run(
        input,
        "reply to question",
        repositoryPolicy.validateRef(input).pipe(Effect.andThen(runtime.replyQuestion(input))),
      ),
    stopSession: (input: Parameters<typeof runtime.stopSession>[0]) =>
      repositoryPolicy.run(input, "stop session", runtime.stopSession(input)),
    releaseSession: (input: Parameters<typeof runtime.releaseSession>[0]) =>
      repositoryPolicy.run(input, "release session", runtime.releaseSession(input)),
    resumeSession: (input: Parameters<typeof runtime.resumeSession>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.run(
          ref,
          "resume session",
          Effect.gen(function* () {
            const stored = yield* policy.prepareResume(ref);
            const prepared = yield* prepareSavedSpeed(runtime, stored.input, policy);
            if (input.resumeMode === "continue_interrupted_turn") {
              const { resumeMode: _resumeMode, ...continuationInput } = prepared;
              return yield* runtime.continueInterruptedTurn(continuationInput);
            }
            return yield* resumeAndSaveSession({
              ref,
              resume: runtime.resumeSession(prepared),
              save: stored.save,
              release: runtime.releaseSession,
            }).pipe(Effect.map(({ session }) => session));
          }),
        );
      }),
    sendUserMessage: (input: Parameters<typeof runtime.sendUserMessage>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.runSend(
          ref,
          Effect.gen(function* () {
            const prepared = yield* policy.prepareSend(ref).pipe(
              Effect.flatMap((stored) => prepareSavedSpeed(runtime, stored, policy)),
              Effect.mapError(messageSubmissionRejected("agent-session.prepare-send")),
            );
            const accepted = yield* runtime.sendUserMessage(prepared);
            yield* policy.recordAcceptedMessage(ref, accepted).pipe(
              Effect.mapError(
                (cause) =>
                  new AgentSessionMessageAcceptedError(
                    {
                      sessionRef: {
                        repoPath,
                        runtimeKind: ref.runtimeKind,
                        workingDirectory: ref.workingDirectory,
                        externalSessionId: ref.externalSessionId,
                      },
                      acceptedMessage: accepted,
                      stage: "record_message",
                    },
                    cause,
                  ),
              ),
            );
            return accepted;
          }),
        );
      }),
    updateSessionModel: (input: Parameters<typeof runtime.updateSessionModel>[0]) =>
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        const ref = { ...input, repoPath };
        const policy = policyFor(input.sessionScope);
        return yield* policy.run(
          ref,
          "change session model",
          policy.prepareModelUpdate(ref).pipe(Effect.flatMap(updateModel)),
        );
      }),
  };
};
