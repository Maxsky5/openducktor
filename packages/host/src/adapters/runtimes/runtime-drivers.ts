import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { RuntimeDriver, RuntimeDrivers } from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { RuntimeSessionOperations } from "./runtime-session-operations";

export type CreateRuntimeDriversInput = {
  descriptorFor: (kind: RuntimeKind) => RuntimeDescriptor;
  starters: Readonly<Record<RuntimeKind, RuntimeStarterPort>>;
  sessionOperations: Readonly<Record<RuntimeKind, RuntimeSessionOperations>>;
  runtimeHealth: Pick<RuntimeHealthPort, "getRuntimeHealth">;
  toolDiscovery: Pick<ToolDiscoveryPort, "validateToolPath">;
};

/** Builds the runtime orchestration driver of each kind from its host adapters. */
export const createRuntimeDrivers = ({
  descriptorFor,
  starters,
  sessionOperations,
  runtimeHealth,
  toolDiscovery,
}: CreateRuntimeDriversInput): RuntimeDrivers<HostError> => {
  const driverFor = (kind: RuntimeKind): RuntimeDriver<HostError> => {
    const descriptor = descriptorFor(kind);
    const operations = sessionOperations[kind];
    return {
      descriptor,
      start: (context) =>
        starters[kind].startRuntime({ ...context, runtimeKind: kind, descriptor }),
      probeVersion: (executablePath) =>
        runtimeHealth.getRuntimeHealth(kind, executablePath).pipe(
          Effect.map((health) => health.version),
          Effect.orElseSucceed(() => null),
        ),
      validateExecutable: (executablePath) =>
        toolDiscovery.validateToolPath(kind, executablePath).pipe(Effect.asVoid),
      stopSession: (target, runtime) => operations.stopSession(target, runtime),
      probeSession: (target, runtime) => operations.probeSessionStatus(target, runtime),
    };
  };
  return {
    opencode: driverFor("opencode"),
    codex: driverFor("codex"),
    claude: driverFor("claude"),
  };
};
