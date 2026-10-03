import type {
  AgentSessionLiveBaseline,
  AgentSessionLiveRefreshInput,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { LiveStateCoordinator } from "./live-state-coordinator";

export const createLiveProjectionAttachment =
  ({
    registry,
    coordinator,
    initialize,
    isCovered,
    listSnapshots,
    readCursor,
    failures,
  }: {
    registry: AgentSessionLiveAdapterRegistryPort;
    coordinator: LiveStateCoordinator;
    isCovered: (adapter: AgentSessionLiveAdapterPort) => boolean;
    initialize: (adapter: AgentSessionLiveAdapterPort) => Effect.Effect<void, HostError>;
    listSnapshots: (
      repoPath: string,
    ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
    readCursor: (repoPath: string) => AgentSessionLiveBaseline["cursor"];
    failures: (repoPath: string) => AgentSessionLiveBaseline["failures"];
  }) =>
  (input: AgentSessionLiveRefreshInput): Effect.Effect<AgentSessionLiveBaseline, HostError> =>
    Effect.gen(function* () {
      for (;;) {
        const registrations = registry.listForRepo(input.repoPath);
        yield* Effect.forEach(registrations, initialize);
        const baseline = yield* coordinator.run(
          Effect.gen(function* () {
            const current = registry.listForRepo(input.repoPath);
            if (
              current.length !== registrations.length ||
              current.some((adapter) => !registrations.includes(adapter) || !isCovered(adapter))
            )
              return null;
            const sessions = yield* listSnapshots(input.repoPath);
            if (current.some((adapter) => !isCovered(adapter))) return null;
            const unavailable = failures(input.repoPath);
            return {
              repoPath: input.repoPath,
              sessions: [...sessions],
              cursor: readCursor(input.repoPath),
              runtimeGenerations: current.map((adapter) => ({
                runtimeKind: adapter.binding.runtimeKind,
                generation: adapter.binding.generation,
              })),
              complete: unavailable.length === 0,
              failures: unavailable,
            };
          }),
        );
        if (baseline) return baseline;
      }
    });
