import {
  type AgentSessionLiveSnapshot,
  knownRuntimeKindValues,
  type RuntimeKind,
  type RuntimeLifecycleEffect,
  type RuntimeLifecycleWorkspaceImpact,
} from "@openducktor/contracts";
import { normalizePathForComparison } from "@openducktor/path-support";
import type {
  RuntimeSetting,
  RuntimeSettings,
  RuntimeWorkspace,
} from "../ports/runtime-orchestration-ports";
import { reviewedSession } from "./runtime-impact-review";

/** The change of one kind that a restart or a settings change makes. */
export type RuntimeKindPlan = {
  readonly kind: RuntimeKind;
  /** Null when only a setting changes and the runtime keeps running as it is. */
  readonly effect: RuntimeLifecycleEffect | null;
  readonly enabled: boolean;
  readonly executablePath: string;
  readonly oldExecutablePath: string | null;
};

export type RuntimeLifecyclePlan = RuntimeKindPlan & { readonly effect: RuntimeLifecycleEffect };

/** The runtime changes of one settings change. Kinds without a change are left out. */
export type RuntimeSettingsChange = {
  readonly plans: ReadonlyArray<RuntimeKindPlan>;
  /** The kinds whose runtime starts, stops, or restarts. */
  readonly lifecycleKinds: ReadonlyArray<RuntimeKind>;
};

const lifecycleEffectFor = (
  before: RuntimeSetting,
  after: RuntimeSetting,
): RuntimeLifecycleEffect | null => {
  if (before.enabled && !after.enabled) return "stop";
  if (!before.enabled && after.enabled) return "start";
  if (after.enabled && before.executablePath !== after.executablePath) return "replace";
  return null;
};

export const hasLifecycleEffect = (plan: RuntimeKindPlan): plan is RuntimeLifecyclePlan =>
  plan.effect !== null;

/** Compares the saved runtime settings with the next ones. */
export const planSettingsChange = (
  current: RuntimeSettings,
  next: RuntimeSettings,
): RuntimeSettingsChange => {
  const plans = knownRuntimeKindValues.flatMap((kind): RuntimeKindPlan[] => {
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
  return { plans, lifecycleKinds: plans.filter(hasLifecycleEffect).map((plan) => plan.kind) };
};

/** Restarts an enabled kind. A disabled kind can only finish a saved stop. */
export const planRestart = (kind: RuntimeKind, saved: RuntimeSetting): RuntimeLifecyclePlan => ({
  kind,
  effect: saved.enabled ? "restart" : "stop",
  enabled: saved.enabled,
  executablePath: saved.executablePath,
  oldExecutablePath: null,
});

/** Binds a confirmation to the exact settings change that the user reviewed. */
export const settingsActionKey = (change: RuntimeSettingsChange): string =>
  `settings:${JSON.stringify(
    change.plans.map((plan) => [plan.kind, plan.effect, plan.enabled, plan.executablePath]),
  )}`;

export const stopsLiveWork = (effect: RuntimeLifecycleEffect | null): boolean =>
  effect === "stop" || effect === "replace" || effect === "restart";

/** Groups affected sessions by the configured workspace of their repository. */
export const groupSessionsByWorkspace = (
  workspaces: ReadonlyArray<RuntimeWorkspace>,
  snapshots: ReadonlyArray<AgentSessionLiveSnapshot>,
): RuntimeLifecycleWorkspaceImpact[] => {
  const byPath = new Map(
    workspaces.map((workspace) => [normalizePathForComparison(workspace.repoPath), workspace]),
  );
  const groups = new Map<string, RuntimeLifecycleWorkspaceImpact>();
  for (const snapshot of snapshots) {
    const repoPath = snapshot.ref.repoPath;
    const workspace = byPath.get(normalizePathForComparison(repoPath)) ?? null;
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
