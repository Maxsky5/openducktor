import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel: AgentSessionModelSelection | null;
  attach(): Promise<void>;
};
/** Names the conversation to import and the workspace that will own it. */
export type RuntimeSessionImportRequest = SessionRef & { workspaceId: string };
export type RuntimeSessionImportPort = {
  /** Scans root conversations for one workspace repository. The host still filters scope. */
  scanSessions(input: {
    repoPath: string;
    signal: AbortSignal;
  }): AsyncIterable<WorkspaceSessionExternal[]>;
  inspectSession(input: RuntimeSessionImportRequest): Promise<RuntimeSessionImportSource>;
};
