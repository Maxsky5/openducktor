import type {
  AgentSessionAuthorizedRoot,
  AgentSessionControlSummary,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionResumeIntent,
  AgentSessionUsageLimitAutoResumeCancelInput,
  WorkflowFailure,
} from "@openducktor/contracts";
import { agentSessionRefKey, type UsageLimitRecovery } from "@openducktor/core";
import { Cause, Clock, Deferred, Effect, Exit, type Fiber, FiberSet, Scope } from "effect";
import {
  causeChainMessage,
  causeMessage,
  errorMessage,
  type HostError,
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import { createSerialLane } from "../../effect/serial-gate";
import type { AgentRuntimeQueryAdapterPort } from "../../ports/agent-runtime-query-port";
import type { RuntimeQueryError } from "../../ports/runtime-query-error";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { SettingsConfigPort, SettingsConfigView } from "../../ports/settings-config-port";
import { SessionOperationError } from "../../ports/session-operation-error";
import { sessionLiveRef } from "./agent-session-continuation-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import { hasBlockingInput, hasForegroundTurn } from "./session-foreground-readiness";
import { resolveOwnedSessionRoot } from "./session-owner-resolution";
import {
  createUsageLimitStops,
  supportsUsageLimitAutoResume,
  type TrackedUsageLimitStop,
} from "./usage-limit-stops";

export { USAGE_LIMIT_RESUME_GRACE_MS } from "./usage-limit-stops";

/** The longest wait between two clock reads, so a computer that wakes resumes within a minute. */
const MAX_WAIT_MS = 60_000;
/** The history reads that a rebuild runs at once. */
const REBUILD_CONCURRENCY = 4;

type RegisteredAdapter = {
  readonly binding: Pick<AgentSessionLiveAdapterPort["binding"], "runtimeKind">;
  readonly queries: Pick<AgentRuntimeQueryAdapterPort, "readLatestUsageLimitStop">;
};

export type UsageLimitAutoResumeServiceDependencies = {
  live: Pick<AgentSessionLiveStateService, "publishUsageLimitAutoResume" | "read">;
  /** The resume of the Resume button. */
  resume: (input: AgentSessionResumeIntent) => Effect.Effect<AgentSessionControlSummary, HostError>;
  /** The saved session roots of the open workspaces of a repository. */
  readRoots: (repoPath: string) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
  /** The repository paths of the open workspaces. */
  listRepoPaths: () => Effect.Effect<readonly string[], HostError>;
  /** Asks the runtime of the session, just before the resume, if the account works again. */
  readUsageLimitRecovery: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<UsageLimitRecovery, HostError | RuntimeQueryError>;
  settingsConfig: Pick<SettingsConfigPort, "readConfig">;
  /** Host failures. The shells stop the host on them. */
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void>;
  /**
   * Logs a failed history read of one session. A runtime can refuse the read, for example Codex
   * without a ChatGPT sign-in, so the other sessions still rebuild and the host keeps running.
   */
  logReadFailure: (message: string) => Effect.Effect<void, HostError>;
};

const failureOf = (cause: unknown): WorkflowFailure =>
  cause instanceof SessionOperationError && cause.observation.failure
    ? cause.observation.failure
    : {
        stage: "continue",
        code: cause instanceof Error ? cause.name : "operation_failed",
        message: errorMessage(cause),
        nextAction: "Review the reported failure, then select Resume.",
      };

/**
 * Resumes a session that stopped on a usage limit after the reported reset. It learns stops from
 * the live stream and, after a host start, from runtime history. `usage-limit-stops.ts` owns the
 * rules. This service runs the reads, the schedule, the resume, and the publication. All state
 * stays in memory, so a host restart loses cancels and attempts.
 */
export const createUsageLimitAutoResumeService = (
  deps: UsageLimitAutoResumeServiceDependencies,
) => {
  let phase: "pending" | "ready" | "stopped" = "pending";
  const publications = createSerialLane();
  const scope = Scope.makeUnsafe();
  const fibers = Effect.runSync(Scope.provide(FiberSet.make<void>(), scope));
  let wakeUp = Deferred.makeUnsafe<void>();
  // Background work runs with the services of `initialize`, such as its clock.
  let runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E> = Effect.runFork;

  const report = (operation: string, cause: unknown) =>
    deps.onBackgroundFailure(
      new HostOperationError({
        operation: `usage-limit-auto-resume.${operation}`,
        message: `Auto-resume after a usage limit failed: ${errorMessage(cause)}`,
        cause,
      }),
    );

  const runBackground = (operation: string, work: Effect.Effect<void, HostError>): void => {
    if (phase === "stopped") return;
    runFork(
      FiberSet.run(
        fibers,
        work.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : report(operation, causeMessage(cause)),
          ),
        ),
      ),
    );
  };

  /**
   * Wakes the scheduler and publishes the current entry of a session. The live owner skips an
   * entry that did not change. The live observer applies the rules inside the live coordinator
   * lane, so the publication runs later, in order.
   */
  const changed = (ref: AgentSessionLiveRef): void => {
    Deferred.doneUnsafe(wakeUp, Exit.void);
    runBackground(
      "publish",
      publications.run(
        Effect.suspend(() => deps.live.publishUsageLimitAutoResume(ref, stops.entry(ref))),
      ),
    );
  };
  const stops = createUsageLimitStops(changed);

  const findRoot = (ref: AgentSessionLiveRef) => {
    const key = agentSessionRefKey(ref);
    return deps
      .readRoots(ref.repoPath)
      .pipe(Effect.map((roots) => roots.find((root) => agentSessionRefKey(root) === key) ?? null));
  };

  /** A stop is planned only for a root of an open workspace. */
  const plan = (stop: TrackedUsageLimitStop | null): void => {
    if (stop)
      runBackground(
        "plan",
        findRoot(stop.ref).pipe(Effect.map((root) => stops.planned(stop, root !== null))),
      );
  };

  /** Resumes one due stop, after the checks that can change while it waits. */
  const attempt = (stop: TrackedUsageLimitStop): Effect.Effect<void> =>
    Effect.gen(function* () {
      const root = yield* findRoot(stop.ref);
      if (!stops.isDue(stop)) return;
      // An archived session, a closed or reset task, and a closed workspace have no root.
      if (!root) {
        stops.cancel(stop.ref, stop.stopId);
        return;
      }
      const idleCountBefore = stops.idleCount(stop.ref);
      const live = yield* deps.live.read(stop.ref);
      if (!stops.isDue(stop)) return;
      const blockedOnInput = live.type === "live" && hasBlockingInput(live.session);
      const hasActiveTurn = live.type === "live" && hasForegroundTurn(live.session);
      if (blockedOnInput || hasActiveTurn) {
        stops.startResume(stop, {
          blockedOnInput,
          hasActiveTurn,
          idleCountBefore,
          now: yield* Clock.currentTimeMillis,
          recovery: { kind: "unknown" },
        });
        return;
      }
      const recovery = yield* deps.readUsageLimitRecovery(stop.ref);
      const started = stops.startResume(stop, {
        blockedOnInput: false,
        hasActiveTurn: false,
        idleCountBefore,
        now: yield* Clock.currentTimeMillis,
        recovery,
      });
      if (!started) return;
      const result = yield* Effect.result(
        deps.resume({
          ...stop.ref,
          sessionScope: root.sessionScope,
          resumeMode: "continue_interrupted_turn",
        }),
      );
      stops.finishResume(stop, result._tag === "Success" ? null : failureOf(result.failure));
    }).pipe(Effect.catch((cause) => Effect.sync(() => stops.finishResume(stop, failureOf(cause)))));

  /** Waits for the earliest due stop. It reads the clock at least once a minute. */
  const scheduler: Effect.Effect<void> = Effect.gen(function* () {
    for (;;) {
      const signal = wakeUp;
      const now = yield* Clock.currentTimeMillis;
      const { due, nextDueAt } = stops.takeDue(now);
      for (const stop of due) runBackground("resume", attempt(stop));
      yield* nextDueAt === undefined
        ? Deferred.await(signal)
        : Effect.raceFirst(
            Deferred.await(signal),
            Effect.sleep(Math.min(nextDueAt - now, MAX_WAIT_MS)),
          );
      if (Deferred.isDoneUnsafe(signal)) wakeUp = Deferred.makeUnsafe<void>();
    }
  });

  /** Reads the history of one root. The rebuild listed the root, so its stop needs no root check. */
  const restore = (
    adapter: RegisteredAdapter,
    root: AgentSessionAuthorizedRoot,
  ): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const ref = sessionLiveRef(root);
      if (stops.hasStop(ref)) return;
      const workCountBefore = stops.workCount(ref);
      const read = yield* Effect.result(adapter.queries.readLatestUsageLimitStop(root));
      if (read._tag === "Failure")
        return yield* deps.logReadFailure(
          `Auto-resume cannot read the usage limit of session '${root.externalSessionId}': ${causeChainMessage(read.failure)}`,
        );
      const now = yield* Clock.currentTimeMillis;
      const stop = stops.restore(ref, read.success, workCountBefore, now);
      if (stop) stops.planned(stop, true);
    });

  /** Plans the stops that runtime history reports for the roots of one runtime. */
  const rebuild = (adapter: RegisteredAdapter): Effect.Effect<void, HostError> =>
    Effect.gen(function* () {
      const roots = yield* Effect.forEach(yield* deps.listRepoPaths(), deps.readRoots, {
        concurrency: REBUILD_CONCURRENCY,
      });
      yield* Effect.forEach(
        roots.flat().filter((root) => root.runtimeKind === adapter.binding.runtimeKind),
        (root) => restore(adapter, root),
        { concurrency: REBUILD_CONCURRENCY, discard: true },
      );
    });

  return {
    /** Reads the setting and starts the scheduler. */
    initialize: (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (phase !== "pending") return;
        const loaded = yield* Effect.result(deps.settingsConfig.readConfig());
        if (loaded._tag === "Failure") {
          yield* report("initialize", loaded.failure);
          return;
        }
        phase = "ready";
        runFork = Effect.runForkWith(yield* Effect.context<never>());
        stops.setEnabled(loaded.success.chat.autoResumeAfterUsageLimits);
        runBackground("schedule", scheduler);
      }),
    /** Applies a saved setting at once to every pending stop. */
    configCommitted: (config: SettingsConfigView): Effect.Effect<void> =>
      Effect.sync(() => {
        if (phase === "ready") stops.setEnabled(config.chat.autoResumeAfterUsageLimits);
      }),
    observe: (envelope: AgentSessionLiveEnvelope): void => {
      if (phase !== "stopped") plan(stops.observe(envelope));
    },
    /** Rebuilds the pending resumes of a runtime from its history, in the background. */
    runtimeRegistered: (adapter: RegisteredAdapter): void => {
      if (supportsUsageLimitAutoResume(adapter.binding.runtimeKind))
        runBackground("rebuild", rebuild(adapter));
    },
    cancel: (input: AgentSessionUsageLimitAutoResumeCancelInput): Effect.Effect<void, HostError> =>
      Effect.gen(function* () {
        const roots = yield* deps.readRoots(input.repoPath);
        yield* resolveOwnedSessionRoot({ ref: input, roots, sessions: [] });
        if (!stops.cancel(input, input.stopId))
          return yield* new HostValidationError({
            field: "stopId",
            message: "The resume already started. Use Stop session to stop the turn.",
          });
      }),
    /** Stops the scheduler and running attempts before the runtimes stop. */
    dispose: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        phase = "stopped";
        stops.clear();
        return Scope.close(scope, Exit.void);
      }),
  };
};

export type UsageLimitAutoResumeService = ReturnType<typeof createUsageLimitAutoResumeService>;
