import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionMetadataPage = {
  sessions: WorkspaceSessionExternal[];
  /** Pass this unchanged to the next metadata request; null ends the list. */
  nextPageToken: string | null;
};
export type RuntimeSessionImportHandle = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  /** Register the source in live state after the workspace record is saved. */
  commit(): Promise<void>;
  /** Close native resources that were not registered. */
  dispose(): Promise<void>;
};
export type RuntimeSessionImportPort = {
  /** Read root-session metadata without opening or registering conversations. */
  listMetadataPage(input: {
    pageToken?: string;
    signal: AbortSignal;
  }): Promise<RuntimeSessionMetadataPage>;
  /** Recheck one selected source by its exact native identity. */
  getMetadata(input: SessionRef): Promise<WorkspaceSessionExternal>;
  /** Open the selected source without registering it in live state. */
  openForImport(input: SessionRef): Promise<RuntimeSessionImportHandle>;
};
