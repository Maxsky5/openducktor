import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

export type RuntimeSessionImportSource = {
  metadata: WorkspaceSessionExternal;
  selectedModel: AgentSessionModelSelection | null;
  attach(): Promise<void>;
};
export type RuntimeSessionImportPort = {
  scanSessions(signal: AbortSignal): AsyncIterable<WorkspaceSessionExternal[]>;
  inspectSession(input: SessionRef): Promise<RuntimeSessionImportSource>;
};
