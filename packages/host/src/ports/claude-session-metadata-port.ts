import type { Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

/** The working directory of the native history of one session, or the failure of its read. */
export type ClaudeWorkingDirectoryRead =
  | { kind: "read"; directory: string | null }
  | { kind: "failed"; error: HostOperationError };

export type ClaudeSessionMetadataPort = {
  /**
   * The working directory of the native history of each session. The directory is null when Claude
   * keeps no transcript. One call scans the Claude folder once, so read many sessions together.
   * A session whose metadata cannot be read gets its own failure. Only a failed scan of the Claude
   * folder fails the call.
   */
  readWorkingDirectories(
    externalSessionIds: readonly string[],
  ): Effect.Effect<ReadonlyMap<string, ClaudeWorkingDirectoryRead>, HostOperationError>;
};
