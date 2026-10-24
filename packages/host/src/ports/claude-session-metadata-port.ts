import type { Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export type ClaudeSessionMetadataPort = {
  /** The working directory of the native history, or null when Claude keeps no transcript. */
  readWorkingDirectory(externalSessionId: string): Effect.Effect<string | null, HostOperationError>;
};
