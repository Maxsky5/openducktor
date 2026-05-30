import { Effect } from "effect";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { BeadsToolPaths, SharedDoltToolPaths } from "./beads-cli-context";

export const createBeadsToolPathResolver = (toolDiscovery: ToolDiscoveryPort) => () =>
  Effect.gen(function* () {
    return {
      beads: yield* toolDiscovery.resolveToolPath("beads"),
    } satisfies BeadsToolPaths;
  });

export const createSharedDoltToolPathResolver = (toolDiscovery: ToolDiscoveryPort) => () =>
  Effect.gen(function* () {
    return {
      dolt: yield* toolDiscovery.resolveToolPath("dolt"),
    } satisfies SharedDoltToolPaths;
  });
