import type { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

/**
 * `<config-root>/browser/screenshots/<workspaceId>/`: the screenshots that agents take. Chat
 * cards and replies show them in every runtime, also after a restart.
 */
export type BrowserScreenshotStorePort = {
  /**
   * Saves a PNG and returns the `file:` URL of its file. Each workspace keeps only its newest
   * screenshots.
   */
  save(workspaceId: string, png: Uint8Array): Effect.Effect<string, HostOperationErrorAggregate>;
  removeWorkspace(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
};
