import type { RuntimeInstanceSummary } from "@openducktor/contracts";

export type RepoRuntimeFailureKind = "timeout" | "error" | null;

const DIAGNOSTICS_TIMEOUT_PATTERNS = [/reason=timeout\b/i, /timed out waiting for\b/i];

export const classifyRepoRuntimeFailure = (message: string | null): RepoRuntimeFailureKind => {
  if (!message) {
    return null;
  }

  return DIAGNOSTICS_TIMEOUT_PATTERNS.some((pattern) => pattern.test(message))
    ? "timeout"
    : "error";
};

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
