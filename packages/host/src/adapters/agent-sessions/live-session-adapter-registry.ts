import { Effect } from "effect";
import { HostInvariantError, HostResourceError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";

export const createLiveSessionAdapterRegistry = (): AgentSessionLiveAdapterRegistryPort => {
  const adaptersByRuntimeId = new Map<string, AgentSessionLiveAdapterPort>();
  const requireControlAdapter = (
    adapter: AgentSessionLiveAdapterPort,
  ): Effect.Effect<
    AgentSessionRuntimeAdapterPort,
    HostResourceError<{ readonly runtimeId: string }>
  > => {
    if (adapter.supportsSessionControl) {
      return Effect.succeed(adapter);
    }
    return Effect.fail(
      new HostResourceError<{ readonly runtimeId: string }>({
        resource: "agent_session_control_adapter",
        operation: "resolveControl",
        message: `Live runtime '${adapter.binding.runtimeId}' does not provide session control.`,
        details: { runtimeId: adapter.binding.runtimeId },
      }),
    );
  };

  const resolveForScope: AgentSessionLiveAdapterRegistryPort["resolveForScope"] = (scope) =>
    Effect.gen(function* () {
      const adapter = [...adaptersByRuntimeId.values()].find(
        (adapter) =>
          adapter.binding.repoPath === scope.repoPath &&
          adapter.binding.runtimeKind === scope.runtimeKind,
      );
      if (!adapter) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "agent_session_live_adapter",
            operation: "resolveForScope",
            message: `No live ${scope.runtimeKind} runtime owns repo '${scope.repoPath}'.`,
            details: { scope },
          }),
        );
      }
      return adapter;
    });

  return {
    register: (adapter) =>
      Effect.gen(function* () {
        const runtimeId = adapter.binding.runtimeId;
        if (adaptersByRuntimeId.has(runtimeId)) {
          return yield* Effect.fail(
            new HostInvariantError({
              invariant: "agent_session_live_runtime_registered_once",
              message: `Live-session adapter is already registered for runtime '${runtimeId}'.`,
              details: { runtimeId },
            }),
          );
        }
        const existing = [...adaptersByRuntimeId.values()].find(
          (candidate) =>
            candidate.binding.repoPath === adapter.binding.repoPath &&
            candidate.binding.runtimeKind === adapter.binding.runtimeKind,
        );
        if (existing) {
          return yield* Effect.fail(
            new HostInvariantError({
              invariant: "agent_session_live_scope_registered_once",
              message: `Repo '${adapter.binding.repoPath}' already has a ${adapter.binding.runtimeKind} live runtime.`,
              details: {
                repoPath: adapter.binding.repoPath,
                runtimeKind: adapter.binding.runtimeKind,
                currentRuntimeId: existing.binding.runtimeId,
                rejectedRuntimeId: runtimeId,
              },
            }),
          );
        }
        adaptersByRuntimeId.set(runtimeId, adapter);
      }),
    remove: (runtimeId) =>
      Effect.sync(() => {
        const adapter = adaptersByRuntimeId.get(runtimeId) ?? null;
        adaptersByRuntimeId.delete(runtimeId);
        return adapter;
      }),
    listForRepo: (repoPath) =>
      [...adaptersByRuntimeId.values()].filter((adapter) => adapter.binding.repoPath === repoPath),
    resolveForScope,
    resolveControlForScope: (scope) =>
      resolveForScope(scope).pipe(Effect.flatMap(requireControlAdapter)),
  };
};
