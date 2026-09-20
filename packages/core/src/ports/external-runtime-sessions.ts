import type { WorkspaceSessionExternal, WorkspaceSession } from "@openducktor/contracts";
import type { SessionRef } from "../types/agent-orchestrator";

/** Metadata discovery never admits a live root or reads conversation history. */
export type ExternalRuntimeSessionPage = {
  sessions: WorkspaceSessionExternal[];
  nextCursor: string | null;
};
export type PreparedExternalRuntimeSession = {
  metadata: WorkspaceSessionExternal;
  selectedModel?: WorkspaceSession["selectedModel"] | undefined;
  commit(): Promise<void>;
  dispose(): Promise<void>;
};
export type ExternalRuntimeSessionsPort = {
  list(input: { cursor?: string; signal: AbortSignal }): Promise<ExternalRuntimeSessionPage>;
  inspect(input: SessionRef): Promise<WorkspaceSessionExternal>;
  prepare(input: SessionRef): Promise<PreparedExternalRuntimeSession>;
};
