import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionMetadataPage = {
  sessions: WorkspaceSessionExternal[];
  nextPageToken: string | null;
};
export type RuntimeSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  registerLiveSession(): Promise<void>;
};
export type RuntimeSessionImportPort = {
  listRootSessionMetadataPage(input: {
    pageToken?: string;
    signal: AbortSignal;
  }): Promise<RuntimeSessionMetadataPage>;
  openExistingSessionForImport(input: SessionRef): Promise<RuntimeSessionImportSource>;
};
