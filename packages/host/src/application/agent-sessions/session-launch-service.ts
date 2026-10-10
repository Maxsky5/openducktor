import type {
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionUserMessagePart,
  SessionLaunchResult,
} from "@openducktor/contracts";
import { sessionLaunchFailureMessage } from "@openducktor/core";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import { createSerialGate } from "../../effect/serial-gate";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../ports/agent-session-send-error";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import type { SessionLaunchContext, SessionLaunchService } from "./session-launch-types";
import { toControlSessionRef } from "./task-workflow-session-storage";

type Attempt<Request, Result extends SessionLaunchResult> = {
  request: Request;
  result: Result;
  target?: AgentSessionLiveRef;
  session?: {
    ref: AgentSessionLiveRef;
    summary: AgentSessionControlSummary;
    /** Cancellation stops a session that this launch created, not a reused session. */
    created: boolean;
  };
  ownershipSaved: boolean;
  /** This launch holds its session as running, so settlement must release it. */
  held: boolean;
  /**
   * A failed first send. `unsent` keeps the instruction when the runtime did not get it or
   * rejected it. `uncertain` means that the runtime can have accepted it, for example before a
   * timeout.
   */
  sendFailure?:
    | { kind: "unsent"; instruction: AgentSessionUserMessagePart[] }
    | { kind: "uncertain" };
  canceled: boolean;
  /**
   * Stop or launch cleanup already asked the runtime to stop the session, so settlement does not.
   */
  stopped: boolean;
  done: Deferred.Deferred<Result>;
  worker?: Fiber.Fiber<void>;
};

/**
 * Runs each launch in a host worker, one at a time for each owner key. Interrupting a caller only
 * stops its wait for the result. Shutdown interrupts the workers and waits for their cleanup. The
 * host keeps no launch after it settles.
 */
export const createSessionLaunchService = <Request, Result extends SessionLaunchResult>(deps: {
  runtime: Pick<
    SessionLaunchRuntimePort,
    "sendUserMessage" | "holdWorkflowLaunch" | "stopSession" | "reportLaunchFailure"
  >;
  initial: (request: Request) => Result;
  key: (request: Request) => string;
  target?: (request: Request) => AgentSessionLiveRef | undefined;
  run: (context: SessionLaunchContext<Request, Result>) => Effect.Effect<unknown, unknown>;
}): SessionLaunchService<Request, Result> => {
  const active = new Set<Attempt<Request, Result>>();
  const owners = createSerialGate();
  let closing = false;
  const checkCanceled = (attempt: Attempt<Request, Result>) =>
    Effect.suspend(() =>
      attempt.canceled ? Effect.fail(invalid("Session launch was canceled.")) : Effect.void,
    );
  const contextFor = (
    attempt: Attempt<Request, Result>,
  ): SessionLaunchContext<Request, Result> => ({
    request: attempt.request,
    targetSession: (ref) => {
      attempt.target = ref;
    },
    createdSession: (repoPath, summary, { hold }) =>
      Effect.suspend(() => {
        const ref = toControlSessionRef(repoPath, summary);
        attempt.session = { ref, summary, created: true };
        if (!hold) return Effect.void;
        // Settlement also releases a hold that failed after it was taken.
        attempt.held = true;
        return deps.runtime.holdWorkflowLaunch(ref, true);
      }),
    reusedSession: (repoPath, summary) => {
      attempt.session = { ref: toControlSessionRef(repoPath, summary), summary, created: false };
      attempt.ownershipSaved = true;
    },
    ownershipSaved: () => {
      attempt.ownershipSaved = true;
    },
    setResultFields: (fields) => {
      Object.assign(attempt.result, fields);
    },
    skip: (reason) => {
      attempt.result.status = "skipped";
      attempt.result.skipReason = reason;
    },
    checkCanceled: () => checkCanceled(attempt),
    stopSession: (ref) =>
      Effect.suspend(() => {
        attempt.stopped = true;
        return deps.runtime.stopSession(ref);
      }),
    send: (input, instruction) =>
      Effect.gen(function* () {
        yield* checkCanceled(attempt);
        let sent = false;
        // The send stays interruptible, so shutdown does not wait for a slow runtime.
        const reply = yield* Effect.result(
          deps.runtime.sendUserMessage(input, {
            requireNativeAdmission: true,
            onSent: () => {
              sent = true;
            },
          }),
        );
        if (reply._tag === "Success") {
          attempt.result.acceptedMessage = reply.success;
          return;
        }
        if (reply.failure instanceof AgentSessionMessageAcceptedError)
          attempt.result.acceptedMessage = reply.failure.failure.acceptedMessage;
        else
          attempt.sendFailure =
            !sent || reply.failure instanceof AgentSessionMessageRejectedError
              ? { kind: "unsent", instruction }
              : { kind: "uncertain" };
        return yield* Effect.fail(reply.failure);
      }),
  });
  const settle = (attempt: Attempt<Request, Result>, work: Effect.Effect<unknown, unknown>) =>
    // An interruption stops only the work. Cleanup and the result still complete.
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const result = attempt.result;
        const outcome = yield* Effect.exit(restore(work));
        const cleanupErrors: string[] = [];
        if (attempt.session) {
          if (attempt.held) {
            const released = yield* Effect.result(
              deps.runtime.holdWorkflowLaunch(attempt.session.ref, false),
            );
            if (released._tag === "Failure") cleanupErrors.push(released.failure.message);
          }
          // A Stop can reach the runtime before the accepted first instruction starts its turn.
          const stopAfterCancel =
            result.acceptedMessage !== undefined || (attempt.session.created && !attempt.stopped);
          if (attempt.canceled && stopAfterCancel) {
            const stopped = yield* Effect.result(deps.runtime.stopSession(attempt.session.ref));
            if (stopped._tag === "Failure") cleanupErrors.push(stopped.failure.message);
          }
        }
        if (outcome._tag === "Failure") {
          result.status = attempt.canceled ? "canceled" : "failed";
          const message = errorMessage(Cause.squash(outcome.cause));
          result.failure = {
            message:
              attempt.sendFailure?.kind === "uncertain"
                ? `${sentence(message)} ${UNCERTAIN_SEND_GUIDANCE}`
                : message,
            cleanupErrors,
          };
        } else if (result.status !== "skipped") {
          if (attempt.canceled) result.status = "canceled";
          else if (cleanupErrors.length > 0) result.status = "failed";
          else result.status = "completed";
          // A failed stop can leave a created session running, so a canceled launch reports it too.
          if (cleanupErrors.length > 0)
            result.failure = { message: "Session launch cleanup failed.", cleanupErrors };
        }
        if (attempt.session && attempt.ownershipSaved) result.session = attempt.session.summary;
        if (result.status === "failed" && result.session && attempt.sendFailure?.kind === "unsent")
          result.unsentInstruction = attempt.sendFailure.instruction;
        // The caller can leave before settlement, so the saved session must show the failure.
        if (attempt.session && result.session && result.status === "failed" && result.failure) {
          const reported = yield* Effect.result(
            deps.runtime.reportLaunchFailure(
              attempt.session.ref,
              launchFailureNotice(result, result.failure),
            ),
          );
          if (reported._tag === "Failure")
            result.failure.cleanupErrors.push(reported.failure.message);
          else if (reported.success !== null) result.failure.noticeId = reported.success;
        }
        yield* Deferred.succeed(attempt.done, structuredClone(result));
      }),
    );
  return {
    launch: (request) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (closing)
            return yield* invalid(
              "The host is shutting down. It does not accept new session launches.",
            );
          const attempt: Attempt<Request, Result> = {
            request,
            result: deps.initial(request),
            ownershipSaved: false,
            held: false,
            canceled: false,
            stopped: false,
            done: Deferred.makeUnsafe<Result>(),
          };
          const target = deps.target?.(request);
          if (target) attempt.target = target;
          active.add(attempt);
          attempt.worker = yield* Effect.forkDetach(
            owners.run(deps.key(request), settle(attempt, deps.run(contextFor(attempt)))).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => active.delete(attempt)).pipe(
                  // Settlement completes the result. This reports a worker that shutdown
                  // interrupted while it waited in the queue.
                  Effect.andThen(
                    Exit.isFailure(exit)
                      ? Deferred.failCause(attempt.done, exit.cause)
                      : Effect.void,
                  ),
                ),
              ),
              Effect.asVoid,
            ),
          );
          return yield* restore(Deferred.await(attempt.done));
        }),
      ),
    cancelSessionLaunches: (ref) => {
      for (const attempt of active) {
        const target = attempt.session?.ref ?? attempt.target;
        if (
          target?.runtimeKind === ref.runtimeKind &&
          target.workingDirectory === ref.workingDirectory &&
          target.externalSessionId === ref.externalSessionId
        ) {
          attempt.canceled = true;
          // The Stop command stops the native session.
          attempt.stopped = true;
        }
      }
    },
    shutdown: () =>
      Effect.gen(function* () {
        closing = true;
        const running = [...active];
        for (const attempt of running) attempt.canceled = true;
        // Workers can still need runtimes and the task store, which later shutdown steps stop.
        yield* Effect.forEach(
          running,
          (attempt) =>
            (attempt.worker ? Fiber.interrupt(attempt.worker) : Effect.void).pipe(
              // A worker that shutdown interrupts before it starts never runs its exit handler.
              Effect.andThen(Effect.sync(() => active.delete(attempt))),
              Effect.andThen(Deferred.interrupt(attempt.done)),
            ),
          { discard: true },
        );
      }),
  };
};

const UNCERTAIN_SEND_GUIDANCE =
  "The runtime can have received the first instruction. Inspect the session before you send it again.";

// Runtime messages, such as a Codex request timeout, can end without a period.
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

const invalid = (message: string) => new HostValidationError({ field: "sessionLaunch", message });

const launchFailureNotice = (
  result: SessionLaunchResult,
  failure: NonNullable<SessionLaunchResult["failure"]>,
): string => {
  const cause = sessionLaunchFailureMessage(failure);
  if (result.acceptedMessage)
    return `The session received its first instruction, but its launch failed: ${cause}`;
  if (result.unsentInstruction)
    return `The runtime did not accept the first instruction: ${sentence(cause)} Start the launch again or send a new message in this session.`;
  return `The session launch failed: ${cause}`;
};
