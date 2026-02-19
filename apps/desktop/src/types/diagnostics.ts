import type { AgentRuntimeSummary } from "@openblueprint/contracts";

export type RepoOpencodeHealthCheck = {
  runtimeOk: boolean;
  runtimeError: string | null;
  runtime: AgentRuntimeSummary | null;
  mcpOk: boolean;
  mcpError: string | null;
  mcpServerName: string;
  mcpServerStatus: string | null;
  mcpServerError: string | null;
  availableToolIds: string[];
  checkedAt: string;
  errors: string[];
};
