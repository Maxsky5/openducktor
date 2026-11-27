import type { OpenCodeClient } from "@opencode/client";
import { nativeRequest, operationError } from "./opencode-client";

const PLUGIN_LOAD_TIMEOUT_MS = 30_000;
const CATALOG_OPERATION = "load the runtime catalog";

export const createOpenCodeCatalogReadiness = (
  client: OpenCodeClient,
  connectionSignal: AbortSignal,
) => {
  const listeners = new Set<(directory: string) => void>();

  return {
    awaitPlugins: (identity: { repoPath: string; workingDirectory: string }): Promise<void> =>
      nativeRequest(identity, CATALOG_OPERATION, async () => {
        const deadline = AbortSignal.timeout(PLUGIN_LOAD_TIMEOUT_MS);
        const signal = AbortSignal.any([connectionSignal, deadline]);
        signal.throwIfAborted();
        const { promise: updateOrAbort, resolve: wake } = Promise.withResolvers<void>();
        const earlyUpdates = new Set<string>();
        let canonicalDirectory: string | undefined;
        const onUpdate = (directory: string) => {
          if (canonicalDirectory === undefined) earlyUpdates.add(directory);
          else if (directory === canonicalDirectory) wake();
        };
        const onAbort = () => wake();
        // OpenCode publishes plugin.updated after it commits the inventory. Observe the update
        // before listing, since activation can finish while the inventory request is in flight.
        listeners.add(onUpdate);
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          const inventory = await client.plugin.list(
            { location: { directory: identity.workingDirectory } },
            { signal },
          );
          canonicalDirectory = inventory.location.directory;
          if (inventory.data.length === 0 && !earlyUpdates.has(canonicalDirectory))
            await updateOrAbort;
          signal.throwIfAborted();
        } catch (cause) {
          if (deadline.aborted && !connectionSignal.aborted)
            throw operationError(
              identity,
              CATALOG_OPERATION,
              "runtime_unavailable",
              `OpenCode did not finish loading the checkout's plugins within ${PLUGIN_LOAD_TIMEOUT_MS / 1_000} seconds.`,
              "Check the OpenCode plugin settings and logs for this checkout, then retry.",
            );
          throw cause;
        } finally {
          signal.removeEventListener("abort", onAbort);
          listeners.delete(onUpdate);
        }
      }),
    pluginsChanged: (directory: string) => {
      for (const notify of listeners) notify(directory);
    },
  };
};
