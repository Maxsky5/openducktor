import type {
  HostRuntimeSnapshot,
  RuntimeInstanceSummary,
  RuntimeKind,
  RuntimeLifecycleImpact,
  RuntimeRestartResult,
  SettingsSnapshotRuntimePreview,
  SettingsSnapshotSaveInput,
  SettingsSnapshotSaveResult,
} from "@openducktor/contracts";
import { planSettingsChange, type RuntimeOrchestrator } from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";
import {
  mapRuntimeBusy,
  mapRuntimeSettings,
  mapRuntimeUnavailable,
} from "./runtime-orchestration-errors";

export type HostRuntimeService = {
  /** Starts every enabled kind in the background. Never waits for a runtime to become ready. */
  initialize(): Effect.Effect<void>;
  /** The runtime part of the host snapshot. The command handler adds the MCP bridge status. */
  snapshot(): Effect.Effect<Omit<HostRuntimeSnapshot, "mcpBridge">>;
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

/**
 * The host use cases of the shared runtimes. The orchestrator owns the runtime lifecycle; this
 * service adds the host instance identity and joins runtime changes to the settings save.
 */
export const createHostRuntimeService = ({
  hostInstanceId,
  orchestrator,
  settingsService,
}: {
  hostInstanceId: string;
  orchestrator: RuntimeOrchestrator<HostError>;
  settingsService: Pick<
    WorkspaceSettingsService,
    "prepareSettingsSnapshot" | "saveSettingsSnapshotWith"
  >;
}): HostRuntimeService => ({
  initialize: () => orchestrator.initialize(),
  snapshot: () =>
    orchestrator.statuses().pipe(Effect.map((runtimes) => ({ hostInstanceId, runtimes }))),
  requireRuntime: (kind) => mapRuntimeUnavailable(orchestrator.requireReady(kind)),
  restartImpact: (kind) => orchestrator.restartImpact(kind),
  restart: (kind, confirmation) => mapRuntimeBusy(orchestrator.restart(kind, confirmation)),
  previewSettings: (snapshot) =>
    Effect.gen(function* () {
      const prepared = yield* settingsService.prepareSettingsSnapshot(snapshot);
      const change = planSettingsChange(
        prepared.current.agentRuntimes,
        prepared.next.agentRuntimes,
      );
      const impact = yield* orchestrator.previewSettingsChange(change);
      return { impact };
    }),
  // A drain of admitted controls can take a long time, so take the lifecycle reservation before
  // the config write lock. The lock then covers the runtime check and the write. The runtime
  // changes apply after the lock, while the reservation still blocks new work.
  saveSettings: ({ snapshot, runtimeConfirmation }) =>
    Effect.gen(function* () {
      const draft = yield* settingsService.prepareSettingsSnapshot(snapshot);
      const { lifecycleKinds } = planSettingsChange(
        draft.current.agentRuntimes,
        draft.next.agentRuntimes,
      );
      return yield* mapRuntimeBusy(
        orchestrator.withSettingsChange(lifecycleKinds, (session) =>
          Effect.gen(function* () {
            const committed = yield* settingsService.saveSettingsSnapshotWith(
              snapshot,
              (prepared, write) =>
                Effect.gen(function* () {
                  // Recheck against the latest settings inside the config write lock.
                  const change = planSettingsChange(
                    prepared.current.agentRuntimes,
                    prepared.next.agentRuntimes,
                  );
                  const check = yield* mapRuntimeSettings(
                    session.check(change, runtimeConfirmation),
                  );
                  if (check.type === "impact_changed") {
                    return { type: "runtime_impact_changed" as const, impact: check.impact };
                  }
                  const workspaces = yield* write;
                  return { type: "saved" as const, workspaces, change };
                }),
            );
            if (committed.type === "runtime_impact_changed") return committed;
            const runtimeApplications = yield* session.apply(committed.change);
            return {
              type: "saved" as const,
              workspaces: committed.workspaces,
              runtimeApplications,
            };
          }),
        ),
      );
    }),
});
