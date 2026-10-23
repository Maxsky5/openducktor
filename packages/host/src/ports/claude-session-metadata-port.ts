import type { Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export type ClaudeSessionMetadataPort = {
  readWorkingDirectory(externalSessionId: string): Effect.Effect<string, HostOperationError>;
};
