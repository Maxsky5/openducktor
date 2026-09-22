import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionMetadataPage = {
  sessions: WorkspaceSessionExternal[];
  nextPageToken: string | null;
};
export type RuntimeSessionImportHandle = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  registerLiveSession(): Promise<void>;
  releaseImportResources(): Promise<void>;
};
export type RuntimeSessionImportPort = {
  listRootSessionMetadataPage(input: {
    pageToken?: string;
    signal: AbortSignal;
  }): Promise<RuntimeSessionMetadataPage>;
  verifyImportSource(input: SessionRef): Promise<WorkspaceSessionExternal>;
  openExistingSessionForImport(input: SessionRef): Promise<RuntimeSessionImportHandle>;
};
