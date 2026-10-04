import {
  type AgentRuntimes,
  type AgentSessionLiveSnapshot,
  type GlobalConfig,
  type HostRuntimeSnapshot,
  knownRuntimeKindValues,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  type RuntimeLifecycleEffect,
  type RuntimeLifecycleImpact,
  type RuntimeLifecycleKindImpact,
  type RuntimeLifecycleWorkspaceImpact,
  type RuntimeRestartResult,
  type RuntimeSettingsApplication,
  type SettingsSnapshotRuntimePreview,
  type SettingsSnapshotSaveInput,
  type SettingsSnapshotSaveResult,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage, type HostError, HostValidationError } from "../../effect/host-errors";
import type {
  RuntimeLifecycleReservation,
  RuntimeRegistryPort,
} from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type {
  PreparedSettingsSnapshot,
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-model";
import {
  createRuntimeImpactConfirmations,
  reviewedSession,
  reviewImpact,
} from "./runtime-impact-confirmations";

type KindPlan = {
  kind: RuntimeKind;
  effect: RuntimeLifecycleEffect | null;
  enabled: boolean;
  executablePath: string;
  oldExecutablePath: string | null;
};

export type HostRuntimeService = {
  /** Starts every enabled kind in the background. Never waits for a runtime to become ready. */
  initialize(): Effect.Effect<void>;
  snapshot(): Effect.Effect<HostRuntimeSnapshot>;
  requireRuntime(kind: RuntimeKind): Effect.Effect<RuntimeInstanceSummary, HostError>;
  restartImpact(kind: RuntimeKind): Effect.Effect<RuntimeLifecycleImpact, HostError>;
  restart(kind: RuntimeKind, confirmation: string): Effect.Effect<RuntimeRestartResult, HostError>;
  previewSettings(
    snapshot: SettingsSnapshotSaveInput,
  ): Effect.Effect<SettingsSnapshotRuntimePreview, HostError>;
  saveSettings(input: {
    snapshot: SettingsSnapshotSaveInput;
    runtimeConfirmation?: string | undefined;
  }): Effect.Effect<SettingsSnapshotSaveResult, HostError>;
};

export const createHostRuntimeService = ({
  hostInstanceId,
  registry,
  settingsConfig,
  settingsService,
  liveSessions,
  toolDiscovery,
  logError,
}: {
  hostInstanceId: string;
  registry: RuntimeRegistryPort;
  settingsConfig: Pick<SettingsConfigPort, "readConfig">;
  settingsService: Pick<
    WorkspaceSettingsService,
    "prepareSettingsSnapshot" | "saveSettingsSnapshotWith"
  >;
  liveSessions: Pick<AgentSessionLiveStateService, "listRuntimeSessions">;
  /** Validates an executable that a save starts, before the save stops or writes anything. */
  toolDiscovery: Pick<ToolDiscoveryPort, "validateToolPath">;
  logError: (message: string) => Effect.Effect<void>;
}): HostRuntimeService => {
  const confirmations = createRuntimeImpactConfirmations();

  const readConfig = settingsConfig.readConfig().pipe(
    Effect.flatMap((config) =>
      config
        ? Effect.succeed(config)
        : Effect.fail(
            new HostValidationError({
              field: "agentRuntimes",
              message: "Runtime settings are not initialized. Open Settings > Runtimes.",
            }),
          ),
    ),
  );

  /** Holds lifecycle ownership while the action runs, so no new work can join it. */
  const withReservation = <A>(
    kinds: RuntimeKind[],
    use: (reservation: RuntimeLifecycleReservation) => Effect.Effect<A, HostError>,
  ) =>
    Effect.acquireUseRelease(registry.reserve(kinds), use, (reservation) => reservation.release());

  const startKind = (kind: RuntimeKind, settings: { enabled: boolean; executablePath: string }) =>
    withReservation([kind], (reservation) =>
      reservation.apply(kind, {
        trigger: "host_startup",
        enabled: settings.enabled,
        configuredExecutablePath: settings.executablePath,
      }),
    ).pipe(
      Effect.catchAll((cause) =>
        logError(`Cannot start the ${kind} runtime at host startup: ${errorMessage(cause)}`),
      ),
    );

  /** Reads the current impact and issues a confirmation bound to it. */
  const readImpact = (actionKey: string, config: GlobalConfig, plans: KindPlan[]) =>
    Effect.gen(function* () {
      const runtimeIds = new Map<string, string | null>();
      const kinds: RuntimeLifecycleKindImpact[] = [];
      const snapshots: AgentSessionLiveSnapshot[] = [];
      for (const plan of plans) {
        if (plan.effect === null) continue;
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
          snapshots.push(...(yield* liveSessions.listRuntimeSessions(plan.kind)));
        }
      }
      const review = reviewImpact(actionKey, runtimeIds, snapshots);
      const impact: RuntimeLifecycleImpact = {
        kinds,
        workspaces: groupByWorkspace(config, snapshots),
        confirmation: confirmations.issue(review),
      };
      return { impact, review };
    });

  const restartPlan = (config: GlobalConfig, kind: RuntimeKind): KindPlan => {
    const saved = config.agentRuntimes[kind];
    return {
      kind,
      effect: saved.enabled ? "restart" : "stop",
      enabled: saved.enabled,
      executablePath: saved.executablePath,
      oldExecutablePath: null,
    };
  };

  const applyPlans = (
    reservation: RuntimeLifecycleReservation,
    trigger: "restart" | "settings",
    plans: KindPlan[],
  ) =>
    Effect.gen(function* () {
      yield* configurePlans(plans.filter((plan) => !hasLifecycleEffect(plan)));
      return yield* Effect.forEach(
        plans.filter(hasLifecycleEffect),
        (plan) =>
          reservation
            .apply(plan.kind, {
              trigger,
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
    });

  return {
    initialize: () =>
      Effect.gen(function* () {
        const config = yield* Effect.either(readConfig);
        if (config._tag === "Left") {
          const message = errorMessage(config.left);
          yield* Effect.forEach(knownRuntimeKindValues, (kind) =>
            registry.recordConfigurationFailure(kind, message),
          );
          return;
        }
        for (const kind of knownRuntimeKindValues) {
          const settings = config.right.agentRuntimes[kind];
          if (!settings.enabled) {
            yield* registry.configure(kind, {
              enabled: false,
              configuredExecutablePath: settings.executablePath,
            });
            continue;
          }
          yield* Effect.forkDaemon(startKind(kind, settings));
        }
      }),
    snapshot: () =>
      registry.statuses().pipe(Effect.map((runtimes) => ({ hostInstanceId, runtimes }))),
    requireRuntime: (kind) => registry.requireReady(kind),
    restartImpact: (kind) =>
      Effect.gen(function* () {
        const config = yield* readConfig;
        const { impact } = yield* readImpact(`restart:${kind}`, config, [
          restartPlan(config, kind),
        ]);
        return impact;
      }),
    restart: (kind, confirmation) =>
      withReservation([kind], (reservation) =>
        Effect.gen(function* () {
          // Read the saved choice under the reservation, so a concurrent save cannot interleave.
          const config = yield* readConfig;
          const plan = restartPlan(config, kind);
          const current = yield* readImpact(`restart:${kind}`, config, [plan]);
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
    previewSettings: (snapshot) =>
      Effect.gen(function* () {
        const prepared = yield* settingsService.prepareSettingsSnapshot(snapshot);
        const plans = settingsPlans(prepared.current.agentRuntimes, prepared.next.agentRuntimes);
        if (!plans.some((plan) => plan.effect !== null)) return { impact: null };
        const { impact } = yield* readImpact(settingsActionKey(plans), prepared.next, plans);
        return { impact };
      }),
    // A drain of admitted controls can take a long time, so take the lifecycle reservation before
    // the config write lock. The lock then covers validation, the impact check, and the write.
    // The runtime changes apply after the lock, while the reservation still blocks new work.
    saveSettings: ({ snapshot, runtimeConfirmation }) =>
      Effect.gen(function* () {
        const draft = yield* settingsService.prepareSettingsSnapshot(snapshot);
        const kinds = lifecycleKinds(
          settingsPlans(draft.current.agentRuntimes, draft.next.agentRuntimes),
        );
        const commit = settingsService.saveSettingsSnapshotWith(snapshot, (prepared, write) =>
          commitSettings(prepared, write, runtimeConfirmation, kinds),
        );
        if (kinds.length === 0) {
          const committed = yield* commit;
          if (committed.type === "runtime_impact_changed") return committed;
          return {
            type: "saved" as const,
            workspaces: committed.workspaces,
            runtimeApplications: [],
          };
        }
        return yield* withReservation(kinds, (reservation) =>
          Effect.gen(function* () {
            const committed = yield* commit;
            if (committed.type === "runtime_impact_changed") return committed;
            const runtimeApplications = yield* applyPlans(reservation, "settings", committed.plans);
            return {
              type: "saved" as const,
              workspaces: committed.workspaces,
              runtimeApplications,
            };
          }),
        );
      }),
  };

  /** Rechecks the save against the latest settings inside the config write lock. */
  function commitSettings(
    prepared: PreparedSettingsSnapshot,
    write: Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>,
    runtimeConfirmation: string | undefined,
    reservedKinds: ReadonlyArray<RuntimeKind>,
  ) {
    return Effect.gen(function* () {
      const plans = settingsPlans(prepared.current.agentRuntimes, prepared.next.agentRuntimes);
      const kinds = lifecycleKinds(plans);
      if (
        kinds.length !== reservedKinds.length ||
        kinds.some((kind) => !reservedKinds.includes(kind))
      ) {
        return yield* new HostValidationError({
          field: "agentRuntimes",
          message: "Runtime settings changed while this save was in progress. Save again.",
        });
      }
      if (kinds.length === 0) {
        const workspaces = yield* write;
        yield* configurePlans(plans);
        return { type: "saved" as const, workspaces, plans };
      }
      yield* Effect.forEach(
        plans.filter((plan) => plan.effect === "start" || plan.effect === "replace"),
        (plan) =>
          toolDiscovery.validateToolPath(plan.kind, plan.executablePath).pipe(
            Effect.mapError(
              (cause) =>
                new HostValidationError({
                  field: `agentRuntimes.${plan.kind}.executablePath`,
                  message: `Cannot use ${plan.executablePath} for the ${plan.kind} runtime: ${cause.message} Fix the executable path, then save again.`,
                  cause,
                }),
            ),
          ),
        { discard: true },
      );
      const current = yield* readImpact(settingsActionKey(plans), prepared.next, plans);
      const hasSessions = current.impact.workspaces.length > 0;
      if (hasSessions && !confirmations.accept(runtimeConfirmation, current.review)) {
        return { type: "runtime_impact_changed" as const, impact: current.impact };
      }
      const workspaces = yield* write;
      return { type: "saved" as const, workspaces, plans };
    });
  }

  /** Records settings that need no lifecycle action. */
  function configurePlans(plans: KindPlan[]) {
    return Effect.forEach(
      plans,
      (plan) =>
        registry.configure(plan.kind, {
          enabled: plan.enabled,
          configuredExecutablePath: plan.executablePath,
        }),
      { discard: true },
    );
  }
};

const settingsActionKey = (plans: KindPlan[]) =>
  `settings:${JSON.stringify(
    plans.map((plan) => [plan.kind, plan.effect, plan.enabled, plan.executablePath]),
  )}`;

const lifecycleEffectFor = (
  before: { enabled: boolean; executablePath: string },
  after: { enabled: boolean; executablePath: string },
): RuntimeLifecycleEffect | null => {
  if (before.enabled && !after.enabled) return "stop";
  if (!before.enabled && after.enabled) return "start";
  if (after.enabled && before.executablePath !== after.executablePath) return "replace";
  return null;
};

const settingsPlans = (current: AgentRuntimes, next: AgentRuntimes): KindPlan[] =>
  knownRuntimeKindValues.flatMap((kind) => {
    const before = current[kind];
    const after = next[kind];
    if (before.enabled === after.enabled && before.executablePath === after.executablePath) {
      return [];
    }
    return [
      {
        kind,
        effect: lifecycleEffectFor(before, after),
        enabled: after.enabled,
        executablePath: after.executablePath,
        oldExecutablePath: before.executablePath,
      },
    ];
  });

type LifecyclePlan = KindPlan & { effect: RuntimeLifecycleEffect };

const hasLifecycleEffect = (plan: KindPlan): plan is LifecyclePlan => plan.effect !== null;

const lifecycleKinds = (plans: ReadonlyArray<KindPlan>): RuntimeKind[] =>
  plans.filter(hasLifecycleEffect).map((plan) => plan.kind);

const stopsLiveWork = (effect: RuntimeLifecycleEffect | null) =>
  effect === "stop" || effect === "replace" || effect === "restart";

const workspaceIndex = (config: GlobalConfig) => {
  const byPath = new Map<string, { workspaceId: string; workspaceName: string }>();
  for (const workspace of Object.values(config.workspaces)) {
    byPath.set(normalizePathForComparison(workspace.repoPath), {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
    });
  }
  return byPath;
};

const groupByWorkspace = (
  config: GlobalConfig,
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>,
): RuntimeLifecycleWorkspaceImpact[] => {
  const workspaces = workspaceIndex(config);
  const groups = new Map<string, RuntimeLifecycleWorkspaceImpact>();
  for (const snapshot of snapshots) {
    const repoPath = snapshot.ref.repoPath;
    const workspace = workspaces.get(normalizePathForComparison(repoPath)) ?? null;
    const group = groups.get(repoPath) ?? {
      workspaceId: workspace?.workspaceId ?? null,
      workspaceName: workspace?.workspaceName ?? null,
      repoPath,
      sessions: [],
    };
    const reviewed = reviewedSession(snapshot);
    const session: RuntimeLifecycleWorkspaceImpact["sessions"][number] = {
      ref: snapshot.ref,
      title: reviewed.title,
      activity: reviewed.activity,
      pendingInputCount: reviewed.pendingRequestIds.length,
    };
    if (reviewed.executionEpisodeId) session.executionEpisodeId = reviewed.executionEpisodeId;
    if (reviewed.parentExternalSessionId) {
      session.parentExternalSessionId = reviewed.parentExternalSessionId;
    }
    group.sessions.push(session);
    groups.set(repoPath, group);
  }
  return [...groups.values()];
};
