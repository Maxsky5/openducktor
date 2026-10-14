import type {
  AcceptedAgentInput,
  AgentMessageTarget,
  AgentSessionAuthorizedRoot,
  AgentSessionLiveRef,
  SessionOperationObservation,
} from "@openducktor/contracts";
import { agentSessionRefKey, agentSessionScopesEqual, isSameSelection } from "@openducktor/core";
import { Cause, Context, Effect } from "effect";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";
import { createSerialGate } from "../../effect/serial-gate";
import { type HostError, HostValidationError, errorMessage } from "../../effect/host-errors";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionCommandAcceptedError,
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../ports/agent-session-send-error";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import { SessionOperationError } from "../../ports/session-operation-error";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";

type Operation = {
  key: string;
  root: AgentSessionAuthorizedRoot;
  assertCurrent: () => void;
  observation: SessionOperationObservation;
  preparation: Record<"model" | "reattach", SessionOperationObservation["nativeOutcome"]>;
};
export const createSessionOperationOwner = (deps: {
  resolveRoot: (ref: AgentSessionLiveRef) => Effect.Effect<AgentSessionAuthorizedRoot, HostError>;
  policyFor: (target: AgentMessageTarget) => AgentSessionOperationPolicy;
  publish: AgentSessionLiveStateService["publishOperation"];
  retain: AgentSessionLiveStateService["retainOperation"];
}) => {
  const workers = createHostOperationWorkers();
  const gate = createSerialGate();
  const workerContext = Context.Reference<boolean>(`session-worker:${crypto.randomUUID()}`, {
    defaultValue: () => false,
  });
  const supervise = <A, E, R>(work: Effect.Effect<A, E, R>) =>
    workers.run(work.pipe(Effect.provideService(workerContext, true)));
  const sessions = new Map<
    string,
    { generation: number; active?: Operation; unresolved?: SessionOperationObservation }
  >();
  const sessionFor = (ref: AgentSessionLiveRef) => {
    const key = agentSessionRefKey(ref);
    let session = sessions.get(key);
    if (!session) sessions.set(key, (session = { generation: 0 }));
    return session;
  };
  const captureGuard = (ref: AgentSessionLiveRef) => {
    const session = sessionFor(ref);
    const generation = session.generation;
    return {
      assertCurrent: () => {
        if (session.generation !== generation)
          throw new HostValidationError({
            field: "operation",
            message: "Stop canceled this preparation. Start a new eligible action to continue.",
          });
      },
    };
  };
  const current = Context.Reference<Operation | null>(`session-operation:${crypto.randomUUID()}`, {
    defaultValue: () => null,
  });
  const publish = (operation: Operation) =>
    deps.publish({ type: "session_operation_updated", observation: { ...operation.observation } });
  const run = <A, E, R>(
    target: AgentMessageTarget,
    kind: SessionOperationObservation["kind"],
    effect: Effect.Effect<A, E, R>,
    submissionId?: string,
    assertSourceCurrent?: () => void,
  ): Effect.Effect<A, E | HostError, R> =>
    Effect.gen(function* () {
      const { repoPath, runtimeKind, workingDirectory, externalSessionId } = target;
      const ref = { repoPath, runtimeKind, workingDirectory, externalSessionId };
      const key = agentSessionRefKey(ref);
      const parent = yield* current;
      // Nested sends retain live admission evidence until the delivery owner settles their result.
      if (parent?.key === key)
        return yield* effect.pipe(
          Effect.provideService(current, {
            ...parent,
            assertCurrent: () => {
              parent.assertCurrent();
              assertSourceCurrent?.();
            },
          }),
          Effect.mapError((failure) =>
            kind === "submission" &&
            submissionId !== undefined &&
            submissionId === parent.observation.submissionId
              ? new SessionOperationError(parent.observation, failure)
              : failure,
          ),
        );
      const session = sessionFor(ref);
      const guard = captureGuard(ref);
      const inWorker = yield* workerContext;
      const owned = gate.run(
        key,
        Effect.gen(function* () {
          const root = yield* deps.resolveRoot(target);
          if (!agentSessionScopesEqual(root.sessionScope, target.sessionScope))
            return yield* new HostValidationError({
              field: "sessionScope",
              message:
                "This session belongs to another task, role, or workspace chat. Reload the chat before continuing.",
            });
          if (kind !== "stop" && session.unresolved) {
            const previous = session.unresolved;
            const observation: SessionOperationObservation = {
              ref,
              kind,
              pending: false,
              nativeOutcome: "not_issued",
              failure: {
                stage: "prior_operation",
                code: "unresolved_operation",
                message: "This session has an earlier operation with uncertain acceptance.",
                nextAction:
                  previous.failure?.nextAction ??
                  "Inspect the original native result before starting more work.",
              },
            };
            if (submissionId) observation.submissionId = submissionId;
            yield* deps.publish({ type: "session_operation_updated", observation });
            return yield* new SessionOperationError(
              observation,
              new HostValidationError({
                field: "operation",
                message: observation.failure!.message,
              }),
            );
          }
          const operation: Operation = {
            key,
            root,
            assertCurrent: () => {
              assertSourceCurrent?.();
              guard.assertCurrent();
            },
            preparation: { model: "not_issued", reattach: "not_issued" },
            observation: {
              ref,
              kind,
              pending: true,
              nativeOutcome: "not_issued",
            },
          };
          if (submissionId) operation.observation.submissionId = submissionId;
          session.active = operation;
          const work = Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: operation.assertCurrent,
                catch: (cause) =>
                  cause instanceof HostValidationError
                    ? cause
                    : new HostValidationError({
                        field: "operation",
                        message: errorMessage(cause),
                        cause,
                      }),
              });
              yield* publish(operation);
              const outcome = yield* Effect.exit(restore(effect));
              operation.observation.pending = false;
              if (outcome._tag === "Failure") {
                const failure = Cause.squash(outcome.cause);
                if (failure instanceof AgentSessionMessageAcceptedError)
                  operation.observation.acceptedInput = failure.failure.acceptedMessage;
                if (failure instanceof AgentSessionCommandAcceptedError)
                  operation.observation.acceptedInput = failure.failure.acceptedCommand;
                if (operation.observation.acceptedInput)
                  operation.observation.nativeOutcome = "accepted";
                else if (failure instanceof AgentSessionAcceptanceUnknownError)
                  operation.observation.nativeOutcome = "uncertain";
                else if (failure instanceof AgentSessionMessageRejectedError)
                  operation.observation.nativeOutcome = "refused";
                else if (failure instanceof AgentSessionResumeError && failure.nativeOutcome) {
                  if (kind === "submission") {
                    operation.preparation.reattach = failure.nativeOutcome;
                    if (failure.nativeOutcome === "accepted")
                      operation.observation.reattached = true;
                  } else operation.observation.nativeOutcome = failure.nativeOutcome;
                }
                const preparationUnknown =
                  operation.preparation.model === "uncertain" ||
                  operation.preparation.reattach === "uncertain";
                let stage: string = kind;
                if (operation.preparation.model === "uncertain") stage = "model";
                else if (
                  operation.preparation.reattach === "uncertain" ||
                  (failure instanceof AgentSessionResumeError && kind === "submission")
                )
                  stage = "reattach";
                let code = "operation_failed";
                if (failure instanceof AgentSessionResumeError) code = failure.reason;
                else if (failure instanceof Error) code = failure.name;
                let nextAction =
                  "Review the reported failure and current session state before continuing.";
                if (operation.observation.nativeOutcome === "uncertain" || preparationUnknown)
                  nextAction =
                    "Inspect the original native operation. Do not repeat it while acceptance is uncertain.";
                else if (failure instanceof AgentSessionResumeError)
                  nextAction = failure.nextAction;
                operation.observation.failure = {
                  stage,
                  code,
                  message: errorMessage(failure),
                  nextAction,
                };
              }
              if (
                operation.preparation.model === "not_issued" &&
                operation.observation.modelChange?.state === "unresolved"
              )
                delete operation.observation.modelChange;
              const publication = yield* Effect.result(publish(operation));
              if (
                operation.observation.nativeOutcome === "uncertain" ||
                operation.preparation.model === "uncertain" ||
                operation.preparation.reattach === "uncertain"
              )
                session.unresolved = { ...operation.observation };
              if (publication._tag === "Failure") {
                operation.observation.failure = {
                  stage: "publish",
                  code: "live_publication_failed",
                  message: errorMessage(publication.failure),
                  nextAction:
                    "Reconnect to read the retained result before retrying this operation.",
                };
                yield* deps.retain(operation.observation);
              }
              if (outcome._tag === "Failure")
                return yield* new SessionOperationError(
                  { ...operation.observation },
                  Cause.squash(outcome.cause),
                );
              if (publication._tag === "Failure")
                return yield* new SessionOperationError(
                  { ...operation.observation },
                  publication.failure,
                );
              return outcome.value;
            }),
          );
          const policy = deps.policyFor(target);
          return yield* (
            kind === "submission"
              ? policy.runSend(target, work)
              : policy.run(
                  target,
                  kind === "reattach" || kind === "continue" ? "resume session" : kind,
                  work,
                )
          ).pipe(
            Effect.provideService(current, operation),
            Effect.ensuring(
              Effect.sync(() => {
                delete session.active;
              }),
            ),
          );
        }),
      );
      return yield* inWorker ? owned : supervise(owned);
    });
  return {
    run,
    supervise,
    captureGuard,
    cancel: (ref: AgentSessionLiveRef) => {
      sessionFor(ref).generation += 1;
    },
    root: (ref: AgentSessionLiveRef) =>
      Effect.gen(function* () {
        const operation = yield* current;
        return operation?.key === agentSessionRefKey(ref)
          ? operation.root
          : yield* deps.resolveRoot(ref);
      }),
    options: (stage: "primary" | "model" | "reattach" = "primary") =>
      Effect.map(current, (operation) => ({
        assertCurrent: operation?.assertCurrent,
        onSent: () => {
          if (!operation) return;
          if (stage !== "primary") operation.preparation[stage] = "uncertain";
          if (stage === "primary" || operation.observation.kind === stage)
            operation.observation.nativeOutcome = "uncertain";
        },
        onAccepted: () => {
          if (!operation) return;
          if (stage !== "primary") operation.preparation[stage] = "accepted";
          if (stage === "reattach") {
            operation.observation.reattached = true;
          }
          if (stage === "primary" || operation.observation.kind === stage)
            operation.observation.nativeOutcome = "accepted";
        },
        wasAccepted: () =>
          (stage === "primary"
            ? operation?.observation.nativeOutcome
            : operation?.preparation[stage]) === "accepted",
      })),
    accepted: (acceptedInput: AcceptedAgentInput) =>
      Effect.gen(function* () {
        const operation = yield* current;
        if (!operation) return;
        operation.observation.acceptedInput = acceptedInput;
        operation.observation.nativeOutcome = "accepted";
        if (operation.observation.submissionId)
          yield* deps.publish({
            type: "submission_acknowledged",
            acknowledgement:
              acceptedInput.type === "command_accepted"
                ? {
                    ref: operation.observation.ref,
                    submissionId: operation.observation.submissionId,
                    kind: "command",
                    acceptedCommand: acceptedInput,
                  }
                : {
                    ref: operation.observation.ref,
                    submissionId: operation.observation.submissionId,
                    kind: "message",
                    messageId: acceptedInput.messageId,
                  },
          });
      }),
    commit: <A>(commit: () => A) =>
      Effect.flatMap(current, (operation) =>
        Effect.try({
          try: () => {
            operation?.assertCurrent();
            return commit();
          },
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : new HostValidationError({
                  field: "operation",
                  message: errorMessage(cause),
                  cause,
                }),
        }),
      ),
    requireStopSettled: (ref: AgentSessionLiveRef) =>
      Effect.suspend(() => {
        const prior = sessions.get(agentSessionRefKey(ref))?.unresolved;
        return prior
          ? Effect.fail(
              new HostValidationError({
                field: "operation",
                message:
                  "Stop reached the runtime, but an earlier operation still has uncertain acceptance. Inspect that native operation before treating Stop as complete.",
              }),
            )
          : Effect.void;
      }),
    controlAccepted: () =>
      Effect.flatMap(current, (operation) => {
        if (operation) operation.observation.nativeOutcome = "accepted";
        return Effect.void;
      }),
    observe: (envelope: import("@openducktor/contracts").AgentSessionLiveEnvelope) => {
      if (envelope.type === "transcript_event" && envelope.event.type === "user_message") {
        const session = sessions.get(agentSessionRefKey(envelope.event.sessionRef));
        if (!session) return;
        const running = session.active;
        if (
          running &&
          running.observation.submissionId === envelope.event.submissionId &&
          envelope.event.submissionId
        ) {
          running.observation.acceptedInput = envelope.event;
          running.observation.nativeOutcome = "accepted";
          return { ...running.observation };
        }
        const prior = session.unresolved;
        if (prior?.submissionId && prior.submissionId === envelope.event.submissionId) {
          delete session.unresolved;
          return { ...prior, nativeOutcome: "accepted" as const, acceptedInput: envelope.event };
        }
      }
      if (envelope.type !== "session_upsert") return;
      const session = sessions.get(agentSessionRefKey(envelope.session.ref));
      if (!session) return;
      const prior = session.unresolved;
      if (!prior || envelope.session.statusUnavailableReason) return;
      if (
        (prior.kind === "model" || prior.failure?.stage === "model") &&
        prior.modelChange?.selection &&
        isSameSelection(prior.modelChange.selection, envelope.session.model)
      ) {
        delete session.unresolved;
        return {
          ...prior,
          nativeOutcome: prior.kind === "model" ? ("accepted" as const) : prior.nativeOutcome,
        };
      }
      if (prior.failure?.stage === "reattach") {
        delete session.unresolved;
        return {
          ...prior,
          reattached: true as const,
          nativeOutcome: prior.kind === "reattach" ? ("accepted" as const) : prior.nativeOutcome,
        };
      }
    },
    modelChanged: (
      selection: import("@openducktor/contracts").AgentSessionModelSelection | null,
      state: "committed" | "restored" | "unresolved",
    ) =>
      Effect.flatMap(current, (operation) => {
        if (operation) {
          operation.observation.modelChange = { selection, state };
          if (state === "unresolved" && operation.preparation.model !== "not_issued")
            operation.preparation.model = "uncertain";
          if (state !== "unresolved") {
            operation.preparation.model = "accepted";
            if (operation.observation.kind === "model")
              operation.observation.nativeOutcome = "accepted";
          }
        }
        return operation ? publish(operation) : Effect.void;
      }),
    reattached: () =>
      Effect.flatMap(current, (operation) => {
        if (operation) {
          operation.observation.reattached = true;
          operation.preparation.reattach = "accepted";
          if (operation.observation.kind === "reattach")
            operation.observation.nativeOutcome = "accepted";
        }
        return operation ? publish(operation) : Effect.void;
      }),
    shutdown: workers.shutdown,
  };
};
