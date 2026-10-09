import type { ClaudeToolCatalogInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { ClaudeToolCatalogPort } from "../../ports/claude-tool-catalog-port";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

export const createClaudeToolCatalogService = (
  dependencies: Dependencies,
): ClaudeToolCatalogPort => ({
  load: (input) =>
    Effect.gen(function* () {
      const selected = yield* getAdapter(input, dependencies);
      const result = yield* selected.catalog.load(input);
      const current = yield* getAdapter(input, dependencies);
      if (current.adapter !== selected.adapter || result.runtimeId !== input.runtimeId) {
        return yield* new HostOperationError({
          operation: "claudeToolCatalog.load",
          message:
            "Claude changed during the tool catalog read. Retry the read for the current runtime.",
        });
      }
      return result;
    }),
});

const getAdapter = (
  input: ClaudeToolCatalogInput,
  dependencies: Dependencies,
): Effect.Effect<
  { adapter: AgentSessionLiveAdapterPort; catalog: ClaudeToolCatalogPort },
  HostError
> =>
  Effect.gen(function* () {
    const runtime = yield* dependencies.runtimeRegistry.requireReady("claude");
    const adapter = dependencies.adapterRegistry
      .list()
      .find(
        (candidate) =>
          candidate.binding.runtimeId === input.runtimeId &&
          candidate.binding.runtimeKind === "claude",
      );
    if (
      runtime.runtimeId !== input.runtimeId ||
      runtime.runtimeRoute.type !== "host_service" ||
      runtime.runtimeRoute.identity !== input.runtimeId ||
      !adapter?.claudeToolCatalog
    ) {
      return yield* new HostOperationError({
        operation: "claudeToolCatalog.load",
        message:
          "The selected Claude runtime changed or has no tool catalog service. Reload Settings and check Claude in Diagnostics.",
      });
    }
    return { adapter, catalog: adapter.claudeToolCatalog };
  });

type Dependencies = {
  runtimeRegistry: Pick<RuntimeRegistryPort, "requireReady">;
  adapterRegistry: Pick<AgentSessionLiveAdapterRegistryPort, "list">;
};
