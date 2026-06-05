import { Effect } from "effect";
import { readSelectedDoltVersion } from "../../infrastructure/beads/beads-shared-dolt-health";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { BeadsToolPaths, SharedDoltToolPaths } from "./beads-cli-context";

export const createBeadsToolPathResolver = (toolDiscovery: ToolDiscoveryPort) => () =>
  Effect.gen(function* () {
    return {
      beads: yield* toolDiscovery.resolveToolPath("beads"),
    } satisfies BeadsToolPaths;
  });

export const createSharedDoltToolPathResolver =
  (toolDiscovery: ToolDiscoveryPort, processEnv: NodeJS.ProcessEnv) => () =>
    Effect.gen(function* () {
      const dolt = yield* toolDiscovery.resolveToolPath("dolt");
      return {
        dolt,
        selectedDoltVersion: yield* readSelectedDoltVersion(dolt, processEnv),
      } satisfies SharedDoltToolPaths;
    });
