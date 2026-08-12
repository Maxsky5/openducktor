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
  ): Effect.Effect<AgentSessionRuntimeAdapterPort, HostResourceError> => {
    if (
      "startSession" in adapter &&
      "resumeSession" in adapter &&
      "forkSession" in adapter &&
      "sendUserMessage" in adapter &&
      "updateSessionModel" in adapter &&
      "stopSession" in adapter &&
      "releaseSession" in adapter
    ) {
      return Effect.succeed(adapter as AgentSessionRuntimeAdapterPort);
    }
    return Effect.fail(
      new HostResourceError({
        resource: "agent_session_control_adapter",
        operation: "resolveControl",
        message: `Live runtime '${adapter.binding.runtimeId}' does not provide session control.`,
        details: { runtimeId: adapter.binding.runtimeId },
      }),
    );
  };

  const findAdapter: AgentSessionLiveAdapterRegistryPort["find"] = (ref) =>
    Effect.gen(function* () {
      const matches = [...adaptersByRuntimeId.values()].filter((adapter) => adapter.matches(ref));
      if (matches.length > 1) {
        return yield* Effect.fail(
          new HostInvariantError({
            invariant: "agent_session_live_ref_has_one_owner",
            message: `Multiple live runtimes claim session '${ref.externalSessionId}' in '${ref.workingDirectory}'.`,
            details: {
              ref,
              runtimeIds: matches.map((adapter) => adapter.binding.runtimeId),
            },
          }),
        );
      }
      return matches[0] ?? null;
    });

  const resolveForScope: AgentSessionLiveAdapterRegistryPort["resolveForScope"] = (scope) =>
    Effect.gen(function* () {
      const matches = [...adaptersByRuntimeId.values()].filter(
        (adapter) =>
          adapter.binding.repoPath === scope.repoPath &&
          adapter.binding.runtimeKind === scope.runtimeKind,
      );
      if (matches.length > 1) {
        return yield* Effect.fail(
          new HostInvariantError({
            invariant: "agent_session_live_scope_has_one_runtime",
            message: `Multiple live runtimes match '${scope.runtimeKind}' in repo '${scope.repoPath}'.`,
            details: {
              scope,
              runtimeIds: matches.map((adapter) => adapter.binding.runtimeId),
            },
          }),
        );
      }
      const adapter = matches[0];
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
    resolveControl: (ref) =>
      Effect.gen(function* () {
        const adapter = yield* findAdapter(ref);
        if (!adapter) {
          return yield* Effect.fail(
            new HostResourceError({
              resource: "agent_session_control_adapter",
              operation: "resolveControl",
              message: `No live runtime owns session '${ref.externalSessionId}' in '${ref.workingDirectory}'.`,
              details: { ref },
            }),
          );
        }
        return yield* requireControlAdapter(adapter);
      }),
    find: findAdapter,
    resolve: (ref) =>
      Effect.gen(function* () {
        const adapter = yield* findAdapter(ref);
        if (!adapter) {
          return yield* Effect.fail(
            new HostResourceError({
              resource: "agent_session_live_adapter",
              operation: "resolve",
              message: `No live runtime owns session '${ref.externalSessionId}' in '${ref.workingDirectory}'.`,
              details: { ref },
            }),
          );
        }
        return adapter;
      }),
  };
};
