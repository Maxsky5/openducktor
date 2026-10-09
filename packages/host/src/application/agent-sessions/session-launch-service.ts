import type { AgentSessionLiveRef, SessionLaunchState } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { agentSessionRefKey } from "@openducktor/core";
import { HostValidationError, type HostError } from "../../effect/host-errors";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../ports/agent-session-send-error";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { SessionLaunchAttempt } from "./session-launch-worker";
import { createSerialLane, type SerialLane } from "../../effect/serial-gate";
import { createSessionLaunchSettlement } from "./session-launch-settlement";
import type {
  SessionLaunchContext,
  SessionLaunchInitial,
  SessionLaunchRef,
  SessionLaunchService,
} from "./session-launch-types";

/** The host owns workers. Interrupting a caller only stops its wait for the result. */
export const createSessionLaunchService = <
  Request extends SessionLaunchRef,
  State extends SessionLaunchState,
  Ref extends SessionLaunchRef,
  Read,
>(deps: {
  runtime: SessionLaunchRuntimePort;
  publish: (state: State) => Effect.Effect<void, HostError>;
  initial: (request: Request) => SessionLaunchInitial<State>;
  key: (owner: Request | Ref | Read) => string;
  queue: (request: Request) => boolean;
  matches: (request: Request, ref: Ref) => boolean;
  includes: (request: Request, read: Read) => boolean;
  validateRead: (read: Read) => Effect.Effect<void, HostError>;
  run: (context: SessionLaunchContext<Request, State>) => Effect.Effect<unknown, unknown>;
  recover: (context: SessionLaunchContext<Request, State>) => Effect.Effect<unknown, unknown>;
}): SessionLaunchService<Request, State, Ref, Read> => {
  const attempts = new Map<string, SessionLaunchAttempt<Request, State>>();
  const owners = new Map<string, Set<SessionLaunchAttempt<Request, State>>>();
  const queues = new Map<string, { lane: SerialLane; users: number }>();
  let closing = false;
  const canRecover = (attempt: SessionLaunchAttempt<Request, State>, settled = false) =>
    !closing &&
    (settled || !attempt.active) &&
    !attempt.canceled &&
    attempt.snapshot.phase === "failed" &&
    attempt.snapshot.failure?.stage !== "publication" &&
    attempt.snapshot.ownershipSaved &&
    !!attempt.sendInput &&
    ["rejected", "not_submitted"].includes(attempt.snapshot.acceptance);
  const snapshot = (attempt: SessionLaunchAttempt<Request, State>, settled = false): State => ({
    ...structuredClone(attempt.snapshot),
    recoveryAllowed: canRecover(attempt, settled),
  });
  const attemptsFor = (ref: AgentSessionLiveRef) =>
    [...attempts.values()].filter((attempt) => {
      const session = attempt.snapshot.session ?? attempt.target;
      return (
        session &&
        attempt.snapshot.repoPath === ref.repoPath &&
        session.runtimeKind === ref.runtimeKind &&
        session.workingDirectory === ref.workingDirectory &&
        session.externalSessionId === ref.externalSessionId
      );
    });
  const cancelRecovery = (attempt: SessionLaunchAttempt<Request, State>) => {
    attempt.canceled = true;
    attempt.snapshot.phase = "canceled";
    delete attempt.sendInput;
  };
  const checkCanceled = (attempt: SessionLaunchAttempt<Request, State>) =>
    Effect.suspend(() =>
      attempt.canceled ? Effect.fail(invalid("Session launch was canceled.")) : Effect.void,
    );
  const { settleSession, settle } = createSessionLaunchSettlement(deps, snapshot);
  const contextFor = (
    attempt: SessionLaunchAttempt<Request, State>,
  ): SessionLaunchContext<Request, State> => ({
    get request() {
      return structuredClone(attempt.request);
    },
    get snapshot() {
      const view = { ...attempt.snapshot };
      delete view.liveSession;
      delete view.acceptedMessage;
      return structuredClone(view);
    },
    get sendInput() {
      return attempt.sendInput ? structuredClone(attempt.sendInput) : undefined;
    },
    updateOwner: (state) => {
      Object.assign(attempt.snapshot, structuredClone(state));
    },
    retainSession: (session) => {
      attempt.snapshot.session = structuredClone(session);
    },
    retainInstruction: (input) => {
      attempt.sendInput = structuredClone(input);
    },
    targetSession: (ref) => {
      attempt.target = structuredClone(ref);
      if (attempt.stoppedSources?.has(agentSessionRefKey(ref))) {
        attempt.canceled = true;
        attempt.stopOwnedBySessionCommand = true;
      }
      delete attempt.stoppedSources;
    },
    ownershipSaved: () => {
      attempt.snapshot.ownershipSaved = true;
    },
    stopSession: (ref) =>
      Effect.suspend(() => {
        attempt.runtimeStopAttempted = true;
        return deps.runtime.stopSession(ref);
      }),
    stage: (stage) => {
      attempt.stage = stage;
    },
    prepare: () =>
      Effect.suspend(() => {
        attempt.snapshot.phase = "preparing";
        return deps.publish(snapshot(attempt));
      }),
    skip: (reason) => {
      attempt.snapshot.phase = "skipped";
      attempt.snapshot.skipReason = reason;
    },
    checkCanceled: () => checkCanceled(attempt),
    withSession: (work) =>
      settleSession(
        attempt,
        work.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (attempt.snapshot.phase !== "skipped") attempt.snapshot.phase = "completed";
            }),
          ),
        ),
      ),
    send: (submit) =>
      Effect.gen(function* () {
        const input = attempt.sendInput;
        if (!input) return yield* invalid("This launch has no retained first instruction.");
        yield* checkCanceled(attempt);
        attempt.stage = "send";
        attempt.snapshot.phase = "sending";
        // A local message receipt does not prove native acceptance.
        yield* deps.publish(snapshot(attempt));
        yield* checkCanceled(attempt);
        attempt.snapshot.acceptance = "unknown";
        const sent = yield* Effect.result(submit(input).pipe(Effect.uninterruptible));
        if (sent._tag === "Success") {
          attempt.snapshot.acceptance = "accepted";
          attempt.snapshot.acceptedMessage = sent.success;
        } else if (sent.failure instanceof AgentSessionMessageAcceptedError) {
          attempt.snapshot.acceptance = "accepted";
          attempt.snapshot.acceptedMessage = sent.failure.failure.acceptedMessage;
          return yield* Effect.fail(sent.failure);
        } else {
          attempt.snapshot.acceptance =
            sent.failure instanceof AgentSessionMessageRejectedError ? "rejected" : "unknown";
          return yield* Effect.fail(sent.failure);
        }
      }),
  });
  const requireAttempt = (ref: Ref) =>
    Effect.suspend(() => {
      const attempt = attempts.get(ref.launchAttemptId);
      return attempt && deps.matches(attempt.request, ref)
        ? Effect.succeed(attempt)
        : Effect.fail(
            invalid(
              `Unknown session launch '${ref.launchAttemptId}' for this owner. Inspect the saved session; do not replay the launch.`,
            ),
          );
    });
  const startWorker = (
    attempt: SessionLaunchAttempt<Request, State>,
    work: Effect.Effect<unknown, unknown>,
  ) =>
    Effect.gen(function* () {
      const done = attempt.done;
      const worker = yield* Effect.forkDetach(settle(attempt, done, work));
      attempt.worker = worker;
      worker.addObserver(() => {
        if (attempt.worker === worker) delete attempt.worker;
      });
      return done;
    });
  const service: SessionLaunchService<Request, State, Ref, Read> = {
    launch: (request) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = attempts.get(request.launchAttemptId);
          if (existing) {
            if (JSON.stringify(existing.request) !== JSON.stringify(request))
              return yield* invalid("Launch attempt ID is already used by another request.");
            return yield* restore(Deferred.await(existing.done));
          }
          if (closing)
            return yield* invalid("The host is shutting down. Session launch admission is closed.");
          const attempt: SessionLaunchAttempt<Request, State> = {
            request: structuredClone(request),
            ...deps.initial(request),
            done: Deferred.makeUnsafe<State>(),
            active: true,
            recovering: false,
            canceled: false,
            runtimeStopAttempted: false,
            stopOwnedBySessionCommand: false,
            stage: "queued",
          };
          attempts.set(request.launchAttemptId, attempt);
          const key = deps.key(request);
          const owned = owners.get(key) ?? new Set<SessionLaunchAttempt<Request, State>>();
          owned.add(attempt);
          owners.set(key, owned);
          let queue = queues.get(key);
          if (!queue) {
            queue = { lane: createSerialLane(), users: 0 };
            queues.set(key, queue);
          }
          queue.users += 1;
          const entry = queue;
          const run = deps.run(contextFor(attempt));
          const work =
            deps.queue(request) || entry.users === 1
              ? entry.lane.run(run)
              : Effect.fail(
                  invalid(
                    "Another session launch is in progress for this owner. Wait for it to finish.",
                  ),
                );
          const done = yield* startWorker(
            attempt,
            work.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  entry.users -= 1;
                  if (entry.users === 0 && queues.get(key) === entry) queues.delete(key);
                }),
              ),
            ),
          );
          return yield* restore(Deferred.await(done));
        }),
      ),
    read: (input) =>
      Effect.gen(function* () {
        yield* deps.validateRead(input);
        return [...(owners.get(deps.key(input)) ?? [])]
          .filter((attempt) => deps.includes(attempt.request, input))
          .map((attempt) => snapshot(attempt));
      }),
    recover: (input) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const attempt = yield* requireAttempt(input);
          while (attempt.active) {
            const joined = attempt.done;
            const recovering = attempt.recovering;
            const completed = yield* restore(Deferred.await(joined));
            if (recovering || completed.phase !== "failed") return completed;
            if (attempt.done !== joined) return yield* restore(Deferred.await(attempt.done));
          }
          if (attempt.snapshot.acceptance === "accepted") return snapshot(attempt);
          if (!canRecover(attempt))
            return yield* invalid(
              "First instruction recovery is unavailable. Inspect the saved session and its runtime acceptance before sending another message.",
            );
          attempt.done = Deferred.makeUnsafe<State>();
          attempt.active = true;
          attempt.recovering = true;
          attempt.snapshot.phase = "sending";
          delete attempt.snapshot.failure;
          const done = yield* startWorker(attempt, deps.recover(contextFor(attempt)));
          return yield* restore(Deferred.await(done));
        }),
      ),
    cancel: (input) => requireAttempt(input).pipe(Effect.flatMap(cancel)),
    cancelSessionBeforeStop: (ref) =>
      Effect.suspend(() => {
        // A queued launch can choose its reuse source after Stop finishes.
        for (const attempt of attempts.values()) {
          if (attempt.active && !attempt.target && !attempt.snapshot.session) {
            attempt.stoppedSources ??= new Set();
            attempt.stoppedSources.add(agentSessionRefKey(ref));
          }
        }
        const matching = attemptsFor(ref).filter(
          (attempt) => attempt.active || canRecover(attempt),
        );
        const workers = matching.filter((attempt) => attempt.active);
        const settled = matching.filter((attempt) => !attempt.active);
        // Joining one worker can open its queue. Cancel every target before waiting.
        matching.forEach((attempt) => {
          attempt.canceled = true;
          attempt.stopOwnedBySessionCommand = true;
        });
        settled.forEach(cancelRecovery);
        return Effect.forEach(workers, (attempt) =>
          attempt.worker ? Fiber.join(attempt.worker) : Effect.void,
        ).pipe(
          Effect.andThen(Effect.forEach(settled, (attempt) => deps.publish(snapshot(attempt)))),
          Effect.asVoid,
        );
      }),
    cancelRecoveryBeforeSend: (ref) =>
      Effect.suspend(() => {
        const matching = attemptsFor(ref);
        if (matching.some((attempt) => attempt.active))
          return Effect.fail(
            invalid(
              "A session launch is in progress. Wait for it to finish before sending a message.",
            ),
          );
        const recoverable = matching.filter((attempt) => canRecover(attempt));
        // Claim every retained instruction before publication can yield to a retry request.
        recoverable.forEach(cancelRecovery);
        return Effect.forEach(recoverable, (attempt) => deps.publish(snapshot(attempt))).pipe(
          Effect.asVoid,
        );
      }),
    shutdown: () =>
      Effect.gen(function* () {
        closing = true;
        const workers = [...attempts.values()].filter((attempt) => attempt.active);
        workers.forEach((attempt) => {
          attempt.canceled = true;
        });
        yield* Effect.forEach(workers, (attempt) =>
          attempt.worker ? Fiber.join(attempt.worker) : Effect.void,
        );
        for (const attempt of attempts.values()) delete attempt.sendInput;
      }),
  };
  const cancel = (attempt: SessionLaunchAttempt<Request, State>) =>
    Effect.gen(function* () {
      if (canRecover(attempt)) {
        cancelRecovery(attempt);
        yield* deps.publish(snapshot(attempt));
        return snapshot(attempt);
      }
      attempt.canceled = true;
      if (attempt.worker) yield* Fiber.join(attempt.worker);
      return snapshot(attempt);
    });
  return service;
};

const invalid = (message: string) => new HostValidationError({ field: "sessionLaunch", message });
