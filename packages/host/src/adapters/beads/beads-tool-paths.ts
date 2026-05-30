import { Effect } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { BeadsToolPaths, SharedDoltToolPaths } from "./beads-cli-context";

export const createBeadsToolPathResolver = (toolDiscovery: ToolDiscoveryPort | undefined) => {
  let cachedToolPaths: BeadsToolPaths | null = null;
  return () =>
    Effect.gen(function* () {
      if (cachedToolPaths) {
        return cachedToolPaths;
      }
      if (!toolDiscovery) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "tool-discovery",
            operation: "beadsTaskRepository.resolveToolPaths",
            message: "Beads task repository requires the tool discovery port.",
          }),
        );
      }
      const nextToolPaths: BeadsToolPaths = {
        beads: yield* toolDiscovery.resolveToolPath("beads"),
      };
      cachedToolPaths = nextToolPaths;
      return nextToolPaths;
    });
};

export const createSharedDoltToolPathResolver = (toolDiscovery: ToolDiscoveryPort | undefined) => {
  let cachedToolPaths: SharedDoltToolPaths | null = null;
  return () =>
    Effect.gen(function* () {
      if (cachedToolPaths) {
        return cachedToolPaths;
      }
      if (!toolDiscovery) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "tool-discovery",
            operation: "beadsTaskRepository.resolveSharedDoltToolPath",
            message: "Shared Dolt server requires the tool discovery port.",
          }),
        );
      }
      const nextToolPaths: SharedDoltToolPaths = {
        dolt: yield* toolDiscovery.resolveToolPath("dolt"),
      };
      cachedToolPaths = nextToolPaths;
      return nextToolPaths;
    });
};
