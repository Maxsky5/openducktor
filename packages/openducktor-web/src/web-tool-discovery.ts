import type { ToolDiscoveryId } from "@openducktor/host";
import { Effect } from "effect";
import { runWebSyncBoundary, WebResourceError } from "./effect/web-errors";

export type WebProvidedToolPaths = Partial<Record<ToolDiscoveryId, string>>;

const currentNodeExecutableEffect = (): Effect.Effect<string, WebResourceError> =>
  Effect.gen(function* () {
    const executable = process.execPath;
    if (!executable) {
      return yield* new WebResourceError({
        resource: "node-executable",
        operation: "web-tool-discovery.resolve",
        message: "OpenDucktor web requires the current Node executable path.",
      });
    }
    return executable;
  });

export const resolveWebProvidedToolPathsEffect = (
  nodeExecutable?: string,
): Effect.Effect<WebProvidedToolPaths, WebResourceError> =>
  Effect.gen(function* () {
    const resolvedNodeExecutable = nodeExecutable ?? (yield* currentNodeExecutableEffect());
    return { node: resolvedNodeExecutable };
  });

export const resolveWebProvidedToolPaths = (nodeExecutable?: string): WebProvidedToolPaths =>
  runWebSyncBoundary(resolveWebProvidedToolPathsEffect(nodeExecutable));
