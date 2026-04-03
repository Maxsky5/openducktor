import type { RuntimeInstanceSummary } from "@openducktor/contracts";

export type RepoRuntimeFailureKind = "timeout" | "error" | null;

export type RepoRuntimeHealthCheck = {
  runtimeOk: boolean;
  runtimeError: string | null;
  runtimeFailureKind: RepoRuntimeFailureKind;
  runtime: RuntimeInstanceSummary | null;
  mcpOk: boolean;
  mcpError: string | null;
  mcpFailureKind: RepoRuntimeFailureKind;
  mcpServerName: string;
  mcpServerStatus: string | null;
  mcpServerError: string | null;
  availableToolIds: string[];
  checkedAt: string;
  errors: string[];
};

export type RepoRuntimeHealthMap = Record<string, RepoRuntimeHealthCheck | null>;
