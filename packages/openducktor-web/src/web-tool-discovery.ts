import type { ToolDiscoveryId } from "@openducktor/host";
import { Effect } from "effect";
import { runWebSyncBoundary, WebResourceError } from "./effect/web-errors";

export type WebProvidedToolPaths = Partial<Record<ToolDiscoveryId, string>>;

const currentBunExecutableEffect = (): Effect.Effect<string, WebResourceError> =>
  Effect.gen(function* () {
    const executable = Bun.argv[0];
    if (!executable) {
      return yield* new WebResourceError({
        resource: "bun-executable",
        operation: "web-tool-discovery.resolve",
        message: "OpenDucktor web requires the current Bun executable path.",
      });
    }
    return executable;
  });

export const resolveWebProvidedToolPathsEffect = (
  bunExecutable?: string,
): Effect.Effect<WebProvidedToolPaths, WebResourceError> =>
  Effect.gen(function* () {
    const resolvedBunExecutable = bunExecutable ?? (yield* currentBunExecutableEffect());
    return { bun: resolvedBunExecutable };
  });

export const resolveWebProvidedToolPaths = (bunExecutable?: string): WebProvidedToolPaths =>
  runWebSyncBoundary(resolveWebProvidedToolPathsEffect(bunExecutable));
