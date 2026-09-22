import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type {
  RuntimeSessionImportPort as NativePort,
  SessionRef,
  RuntimeSessionMetadataPage,
} from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
export type HostSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  registerLiveSession: Effect.Effect<void, HostError>;
};
export type RuntimeSessionImportPort = {
  listRootSessionMetadataPage(
    input: Parameters<NativePort["listRootSessionMetadataPage"]>[0],
  ): Effect.Effect<RuntimeSessionMetadataPage, HostError>;
  openExistingSessionForImport(
    input: SessionRef,
  ): Effect.Effect<HostSessionImportSource, HostError>;
};
