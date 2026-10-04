import {
  type HostMcpBridgeCheck,
  knownRuntimeKindValues,
  type RuntimeDescriptor,
  type RuntimeKind,
  type WorkspaceRuntimeMcpCheck,
  type WorkspaceRuntimeMcpStatus,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, type HostError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

export type RuntimeMcpDiagnosticsService = {
  hostBridgeCheck(): Effect.Effect<HostMcpBridgeCheck>;
  workspaceRuntimeMcpCheck(repoPath: string): Effect.Effect<WorkspaceRuntimeMcpCheck, HostError>;
};

/**
 * Separates host bridge readiness from the MCP connections that runtimes opened for one
 * workspace. Reads observe existing state only; they never start, attach, or connect anything.
 */
export const createRuntimeMcpDiagnosticsService = ({
  checkBridge,
  registry,
  adapterRegistry,
  descriptorFor,
  resolveRepoPath,
}: {
  checkBridge: () => Effect.Effect<HostMcpBridgeCheck>;
  registry: Pick<RuntimeRegistryPort, "status">;
  adapterRegistry: Pick<AgentSessionLiveAdapterRegistryPort, "list">;
  descriptorFor: (kind: RuntimeKind) => RuntimeDescriptor;
  resolveRepoPath: (repoPath: string) => Effect.Effect<string, HostError>;
}): RuntimeMcpDiagnosticsService => {
  const kindStatus = (
    kind: RuntimeKind,
    repoPath: string,
  ): Effect.Effect<WorkspaceRuntimeMcpStatus> =>
    Effect.gen(function* () {
      const base = { kind, runtimeId: null, observations: [], detail: null };
      if (!descriptorFor(kind).capabilities.optionalSurfaces.supportsMcpStatus) {
        return { ...base, state: "unsupported" as const };
      }
      const status = yield* registry.status(kind);
      if (status.state !== "ready") {
        return {
          ...base,
          state: "unavailable" as const,
          detail: `The runtime is ${status.state}.`,
        };
      }
      const adapter = adapterRegistry
        .list()
        .find((candidate) => candidate.binding.runtimeId === status.runtimeId);
      if (!adapter?.readMcpConnections) {
        return { ...base, runtimeId: status.runtimeId, state: "unsupported" as const };
      }
      const observations = yield* Effect.either(adapter.readMcpConnections(repoPath));
      if (observations._tag === "Left") {
        return {
          ...base,
          runtimeId: status.runtimeId,
          state: "unavailable" as const,
          detail: `Cannot read MCP connections: ${errorMessage(observations.left)}`,
        };
      }
      return {
        ...base,
        runtimeId: status.runtimeId,
        state: observations.right.length > 0 ? ("observed" as const) : ("not_checked" as const),
        observations: [...observations.right],
      };
    });

  return {
    hostBridgeCheck: checkBridge,
    workspaceRuntimeMcpCheck: (rawRepoPath) =>
      Effect.gen(function* () {
        const repoPath = yield* resolveRepoPath(rawRepoPath);
        const runtimes: WorkspaceRuntimeMcpStatus[] = yield* Effect.forEach(
          knownRuntimeKindValues,
          (kind) => kindStatus(kind, repoPath),
        );
        return { repoPath, checkedAt: new Date().toISOString(), runtimes };
      }),
  };
};
