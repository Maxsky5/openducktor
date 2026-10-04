import {
  type AgentSessionLiveSnapshot,
  type HostRuntimeStatus,
  knownRuntimeKindValues,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  type RuntimeLifecycleImpact,
  type RuntimeLifecycleKindImpact,
  type RuntimeRestartResult,
  type RuntimeSettingsApplication,
} from "@openducktor/contracts";
import type { Duration } from "effect";
import { Effect } from "effect";
import {
  type RuntimeLifecycleBusyError,
  RuntimeSettingsError,
  type RuntimeShutdownError,
  type RuntimeUnavailableError,
} from "../errors";
import { errorMessage } from "../domain/failure-message";
import {
  createRuntimeImpactConfirmations,
  type ReviewedRuntimeImpact,
  reviewImpact,
} from "../domain/runtime-impact-review";
import {
  groupSessionsByWorkspace,
  hasLifecycleEffect,
  planRestart,
  type RuntimeKindPlan,
  type RuntimeSettingsChange,
  settingsActionKey,
  stopsLiveWork,
} from "../domain/runtime-lifecycle-plan";
import type {
  RuntimeDrivers,
  RuntimeSessionProbe,
  RuntimeSessionTarget,
} from "../ports/runtime-driver";
import type {
  LiveSessionInventory,
  RuntimeObserver,
  RuntimeSettingsSource,
} from "../ports/runtime-orchestration-ports";
import { createRuntimeAdmissionGate, type RuntimeAdmissionGate } from "./runtime-admission-gate";
import { createRuntimeRegistry, type RuntimeLifecycleReservation } from "./runtime-registry";

export type RuntimeSettingsCheck =
  | { type: "accepted" }
  | { type: "impact_changed"; impact: RuntimeLifecycleImpact };

/** A settings change that owns the lifecycle of its kinds until it ends. */
export type RuntimeSettingsChangeSession<E> = {
  /**
   * Checks the latest change against the reserved kinds, the executables it starts, and the
   * reviewed impact. Call it after reading the latest settings and before writing them.
   */
  check(
    change: RuntimeSettingsChange,
    confirmation: string | undefined,
  ): Effect.Effect<RuntimeSettingsCheck, E | RuntimeSettingsError>;
  /** Applies each changed kind independently, after the settings are written. */
  apply(change: RuntimeSettingsChange): Effect.Effect<RuntimeSettingsApplication[]>;
};

export type RuntimeOrchestrator<E> = {
  /** Starts every enabled kind in the background. Never waits for a runtime to become ready. */
  initialize(): Effect.Effect<void>;
  status(kind: RuntimeKind): Effect.Effect<HostRuntimeStatus>;
  statuses(): Effect.Effect<HostRuntimeStatus[]>;
  /** Returns the ready runtime of the kind, or why it is unavailable. It does not admit work. */
  requireReady(kind: RuntimeKind): Effect.Effect<RuntimeInstanceSummary, RuntimeUnavailableError>;
  /** Runs `effect` as a control of the ready kind. A lifecycle action waits for it. */
  admit<A, E2, R>(
    kind: RuntimeKind,
    effect: Effect.Effect<A, E2, R>,
  ): Effect.Effect<A, E2 | RuntimeUnavailableError, R>;
  /** Reads the live sessions a restart stops, with a confirmation bound to them. */
  restartImpact(kind: RuntimeKind): Effect.Effect<RuntimeLifecycleImpact, E>;
  restart(
    kind: RuntimeKind,
    confirmation: string,
  ): Effect.Effect<RuntimeRestartResult, E | RuntimeLifecycleBusyError>;
  /** Reads the impact of a settings change. Null when it starts, stops, or restarts nothing. */
  previewSettingsChange(
    change: RuntimeSettingsChange,
  ): Effect.Effect<RuntimeLifecycleImpact | null, E>;
  /**
   * Reserves `kinds` for a settings change. No new work joins them until `use` ends. A change
   * that starts, stops, or restarts nothing reserves no kind.
   */
  withSettingsChange<A, E2>(
    kinds: ReadonlyArray<RuntimeKind>,
    use: (session: RuntimeSettingsChangeSession<E>) => Effect.Effect<A, E2>,
  ): Effect.Effect<A, E2 | RuntimeLifecycleBusyError>;
  /** Stops every runtime. No runtime can start or become ready afterwards. */
  stopAll(): Effect.Effect<RuntimeInstanceSummary[], RuntimeShutdownError>;
  stopSession(target: RuntimeSessionTarget): Effect.Effect<void, E | RuntimeUnavailableError>;
  probeSession(target: RuntimeSessionTarget): Effect.Effect<RuntimeSessionProbe, E>;
};

export type CreateRuntimeOrchestratorInput<E> = {
  drivers: RuntimeDrivers<E>;
  settings: RuntimeSettingsSource<E>;
  liveSessions: LiveSessionInventory<E>;
  observer: RuntimeObserver;
  /**
   * The gate of runtime-dependent controls. Pass one when other services must admit work before
   * the orchestrator exists.
   */
  admission?: RuntimeAdmissionGate;
  now?: () => Date;
  /** How long a lifecycle action or shutdown waits for admitted controls before it cancels them. */
  controlGrace?: Duration.DurationInput;
};

const SETTINGS_CHANGED_MESSAGE =
  "Runtime settings changed while this save was in progress. Save again.";

/**
 * Runs at most one runtime of each kind for every workspace. It starts enabled kinds, restarts
 * a kind after the user reviews the live work it stops, and applies saved settings changes.
 */
export const createRuntimeOrchestrator = <E>({
  drivers,
  settings,
  liveSessions,
  observer,
  admission = createRuntimeAdmissionGate(),
  now = () => new Date(),
  controlGrace = "10 seconds",
}: CreateRuntimeOrchestratorInput<E>): RuntimeOrchestrator<E> => {
  const registry = createRuntimeRegistry({
    admission,
    drivers,
    onStatusChanged: (change) => observer.statusChanged(change),
    now,
    controlGrace,
  });
  const confirmations = createRuntimeImpactConfirmations();

  /** Holds lifecycle ownership while the action runs, so no new work can join it. */
  const withReservation = <A, E2>(
    kinds: ReadonlyArray<RuntimeKind>,
    use: (reservation: RuntimeLifecycleReservation) => Effect.Effect<A, E2>,
  ) =>
    Effect.acquireUseRelease(registry.reserve(kinds), use, (reservation) => reservation.release());

  /** Reads the current impact and issues a confirmation bound to it. */
  const readImpact = (actionKey: string, plans: ReadonlyArray<RuntimeKindPlan>) =>
    Effect.gen(function* () {
      const runtimeIds = new Map<string, string | null>();
      const kinds: RuntimeLifecycleKindImpact[] = [];
      const snapshots: AgentSessionLiveSnapshot[] = [];
      for (const plan of plans.filter(hasLifecycleEffect)) {
        const status = yield* registry.status(plan.kind);
        runtimeIds.set(plan.kind, status.runtimeId);
        kinds.push({
          kind: plan.kind,
          runtimeId: status.runtimeId,
          effect: plan.effect,
          oldExecutablePath: plan.oldExecutablePath,
          newExecutablePath: plan.effect === "stop" ? null : plan.executablePath,
        });
        if (stopsLiveWork(plan.effect)) {
          snapshots.push(...(yield* liveSessions.listAffectedSessions(plan.kind)));
        }
      }
      const workspaces = yield* settings.listWorkspaces();
      const review: ReviewedRuntimeImpact = reviewImpact(actionKey, runtimeIds, snapshots);
      const impact: RuntimeLifecycleImpact = {
        kinds,
        workspaces: groupSessionsByWorkspace(workspaces, snapshots),
        confirmation: confirmations.issue(review),
      };
      return { impact, review };
    });

  const configurePlans = (plans: ReadonlyArray<RuntimeKindPlan>) =>
    Effect.forEach(
      plans,
      (plan) =>
        registry.configure(plan.kind, {
          enabled: plan.enabled,
          configuredExecutablePath: plan.executablePath,
        }),
      { discard: true },
    );

  const startKind = (kind: RuntimeKind, enabled: boolean, executablePath: string) =>
    withReservation([kind], (reservation) =>
      reservation.apply(kind, {
        trigger: "host_startup",
        enabled,
        configuredExecutablePath: executablePath,
      }),
    ).pipe(
      Effect.catchAll((cause) =>
        Effect.sync(() =>
          observer.backgroundFailure(
            `Cannot start the ${kind} runtime at host startup: ${cause.message}`,
          ),
        ),
      ),
    );

  const settingsChangeSession = (
    reservation: RuntimeLifecycleReservation,
  ): RuntimeSettingsChangeSession<E> => ({
    check: (change, confirmation) =>
      Effect.gen(function* () {
        const reserved = reservation.kinds;
        if (
          change.lifecycleKinds.length !== reserved.length ||
          change.lifecycleKinds.some((kind) => !reserved.includes(kind))
        ) {
          return yield* new RuntimeSettingsError({
            field: "agentRuntimes",
            message: SETTINGS_CHANGED_MESSAGE,
          });
        }
        if (change.lifecycleKinds.length === 0) return { type: "accepted" as const };
        yield* Effect.forEach(
          change.plans.filter((plan) => plan.effect === "start" || plan.effect === "replace"),
          (plan) =>
            drivers[plan.kind].validateExecutable(plan.executablePath).pipe(
              Effect.mapError(
                (cause) =>
                  new RuntimeSettingsError({
                    field: `agentRuntimes.${plan.kind}.executablePath`,
                    message: `Cannot use ${plan.executablePath} for the ${plan.kind} runtime: ${errorMessage(cause)} Fix the executable path, then save again.`,
                    cause,
                  }),
              ),
            ),
          { discard: true },
        );
        const current = yield* readImpact(settingsActionKey(change), change.plans);
        const hasSessions = current.impact.workspaces.length > 0;
        if (hasSessions && !confirmations.accept(confirmation, current.review)) {
          return { type: "impact_changed" as const, impact: current.impact };
        }
        return { type: "accepted" as const };
      }),
    apply: (change) =>
      Effect.gen(function* () {
        yield* configurePlans(change.plans.filter((plan) => !hasLifecycleEffect(plan)));
        return yield* Effect.forEach(
          change.plans.filter(hasLifecycleEffect),
          (plan) =>
            reservation
              .apply(plan.kind, {
                trigger: "settings",
                enabled: plan.enabled,
                configuredExecutablePath: plan.executablePath,
              })
              .pipe(
                Effect.map((outcome): RuntimeSettingsApplication => ({
                  kind: plan.kind,
                  effect: plan.effect,
                  outcome: outcome.type === "completed" ? "applied" : "failed",
                  message:
                    outcome.type === "completed" ? null : (outcome.status.failure?.message ?? null),
                })),
              ),
          { concurrency: "unbounded" },
        );
      }),
  });

  return {
    initialize: () =>
      Effect.gen(function* () {
        const saved = yield* Effect.either(settings.readRuntimeSettings());
        if (saved._tag === "Left") {
          const message = errorMessage(saved.left);
          yield* Effect.forEach(knownRuntimeKindValues, (kind) =>
            registry.recordConfigurationFailure(kind, message),
          );
          return;
        }
        for (const kind of knownRuntimeKindValues) {
          const setting = saved.right[kind];
          if (!setting.enabled) {
            yield* registry.configure(kind, {
              enabled: false,
              configuredExecutablePath: setting.executablePath,
            });
            continue;
          }
          yield* Effect.forkDaemon(startKind(kind, setting.enabled, setting.executablePath));
        }
      }),
    status: (kind) => registry.status(kind),
    statuses: () => registry.statuses(),
    requireReady: (kind) => registry.requireReady(kind),
    admit: (kind, effect) => admission.admit(kind, effect),
    restartImpact: (kind) =>
      Effect.gen(function* () {
        const saved = yield* settings.readRuntimeSettings();
        const { impact } = yield* readImpact(`restart:${kind}`, [planRestart(kind, saved[kind])]);
        return impact;
      }),
    restart: (kind, confirmation) =>
      withReservation([kind], (reservation) =>
        Effect.gen(function* () {
          // Read the saved choice under the reservation, so a concurrent save cannot interleave.
          const saved = yield* settings.readRuntimeSettings();
          const plan = planRestart(kind, saved[kind]);
          const current = yield* readImpact(`restart:${kind}`, [plan]);
          if (!confirmations.accept(confirmation, current.review)) {
            return { type: "impact_changed" as const, impact: current.impact };
          }
          const outcome = yield* reservation.apply(kind, {
            trigger: "restart",
            enabled: plan.enabled,
            configuredExecutablePath: plan.executablePath,
          });
          return { type: outcome.type, status: outcome.status };
        }),
      ),
    previewSettingsChange: (change) =>
      change.lifecycleKinds.length === 0
        ? Effect.succeed(null)
        : readImpact(settingsActionKey(change), change.plans).pipe(
            Effect.map(({ impact }) => impact),
          ),
    withSettingsChange: (kinds, use) =>
      withReservation(kinds, (reservation) => use(settingsChangeSession(reservation))),
    stopAll: () => registry.stopAll(),
    stopSession: (target) => registry.stopSession(target),
    probeSession: (target) => registry.probeSession(target),
  };
};
