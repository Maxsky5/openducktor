import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel: AgentSessionModelSelection | null;
  speed: string | null;
  attach(): Promise<void>;
};
export type RuntimeSessionImportPort = {
  /** Scans root conversations for one workspace repository. The host still filters scope. */
  scanSessions(input: {
    repoPath: string;
    signal: AbortSignal;
  }): AsyncIterable<WorkspaceSessionExternal[]>;
  inspectSession(input: SessionRef): Promise<RuntimeSessionImportSource>;
};
