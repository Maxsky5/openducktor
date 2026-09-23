import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { SessionRef } from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
export type HostSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel: AgentSessionModelSelection | null;
  attach: Effect.Effect<void, HostError>;
};
export type RuntimeSessionImportPort = {
  scanSessions(signal: AbortSignal): {
    next(): Effect.Effect<IteratorResult<WorkspaceSessionExternal[]>, HostError>;
  };
  inspectSession(input: SessionRef): Effect.Effect<HostSessionImportSource, HostError>;
};
