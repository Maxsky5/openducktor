import type {
  LiveSessionInventory,
  RuntimeAdmissionGate,
  RuntimeOrchestrator,
  RuntimeSettingsSource,
} from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import { mapRuntimeShutdown, mapRuntimeUnavailable } from "./runtime-orchestration-errors";

/** Admits host controls through the runtime admission gate, with host errors. */
export const createRuntimeAdmissionPort = (gate: RuntimeAdmissionGate): RuntimeAdmissionPort => ({
  admit: (runtimeKind, effect) => mapRuntimeUnavailable(gate.admit(runtimeKind, effect)),
});

/** Gives host services the shared runtimes of the orchestrator, with host errors. */
export const createRuntimeRegistryPort = (
  orchestrator: RuntimeOrchestrator<HostError>,
): RuntimeRegistryPort => ({
  status: (kind) => orchestrator.status(kind),
  statuses: () => orchestrator.statuses(),
  requireReady: (kind) => mapRuntimeUnavailable(orchestrator.requireReady(kind)),
  stopAllRuntimes: () => mapRuntimeShutdown(orchestrator.stopAll()),
  stopSession: (input) => mapRuntimeUnavailable(orchestrator.stopSession(input)),
  probeSessionStatus: (input) => mapRuntimeUnavailable(orchestrator.probeSession(input)),
});

/** Reads the saved runtime settings and workspaces from the OpenDucktor settings file. */
export const createRuntimeSettingsSource = (
  settingsConfig: Pick<SettingsConfigPort, "readConfig">,
): RuntimeSettingsSource<HostError> => {
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
  return {
    readRuntimeSettings: () => readConfig.pipe(Effect.map((config) => config.agentRuntimes)),
    listWorkspaces: () => readConfig.pipe(Effect.map((config) => Object.values(config.workspaces))),
  };
};

/** Lists the live sessions that a lifecycle action of a runtime kind stops or detaches. */
export const createLiveSessionInventory = (
  liveSessions: Pick<AgentSessionLiveStateService, "listRuntimeSessions">,
): LiveSessionInventory<HostError> => ({
  listAffectedSessions: (runtimeKind) => liveSessions.listRuntimeSessions(runtimeKind),
});
