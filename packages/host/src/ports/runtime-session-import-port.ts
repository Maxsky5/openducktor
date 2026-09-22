import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type {
  RuntimeSessionImportPort as NativePort,
  SessionRef,
  RuntimeSessionMetadataPage,
} from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
export type HostSessionImportHandle = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  commit: Effect.Effect<void, HostError>;
  dispose: Effect.Effect<void, HostError>;
};
export type RuntimeSessionImportPort = {
  listMetadataPage(
    input: Parameters<NativePort["listMetadataPage"]>[0],
  ): Effect.Effect<RuntimeSessionMetadataPage, HostError>;
  getMetadata(input: SessionRef): Effect.Effect<WorkspaceSessionExternal, HostError>;
  openForImport(input: SessionRef): Effect.Effect<HostSessionImportHandle, HostError>;
};
