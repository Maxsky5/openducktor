import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { createSerialLane, type SerialLane } from "../../../effect/serial-gate";

type ConnectionScopeEntry = {
  generation: number;
  lane: SerialLane;
};

export const createAzureDevOpsConnectionScopeGate = () => {
  const entries = new Map<string, ConnectionScopeEntry>();

  const entryFor = (scope: string): ConnectionScopeEntry => {
    let entry = entries.get(scope);
    if (!entry) {
      entry = { generation: 0, lane: createSerialLane() };
      entries.set(scope, entry);
    }
    return entry;
  };

  return {
    currentGeneration(scope: string): number {
      return entryFor(scope).generation;
    },
    invalidate(scope: string): number {
      const entry = entryFor(scope);
      entry.generation += 1;
      return entry.generation;
    },
    requireCurrent(scope: string, generation: number) {
      return entryFor(scope).generation === generation
        ? Effect.void
        : Effect.fail(
            new HostOperationError({
              operation: "azureDevOps.connection.superseded",
              message:
                "The Azure DevOps connection changed before the credential operation completed. Retry the action if you still want to connect.",
            }),
          );
    },
    run<A, E, R>(scope: string, operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
      return entryFor(scope).lane.run(operation);
    },
  };
};
