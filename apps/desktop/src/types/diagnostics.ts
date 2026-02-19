import type { AgentRuntimeSummary } from "@openblueprint/contracts";

export type RepoOpencodeHealthCheck = {
  runtimeOk: boolean;
  runtimeError: string | null;
  runtime: AgentRuntimeSummary | null;
  mcpOk: boolean;
  mcpError: string | null;
  availableToolIds: string[];
  missingRequiredToolIds: string[];
  checkedAt: string;
  errors: string[];
};
