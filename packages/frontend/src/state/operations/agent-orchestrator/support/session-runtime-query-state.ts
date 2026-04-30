import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionRuntimeAccessState = {
  repoPath?: string | null;
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
};

export type SessionRuntimeQueryInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
};

export type SessionRuntimeQueryState = {
  runtimeQueryInput: SessionRuntimeQueryInput | null;
  runtimeQueryError: string | null;
};

export const resolveAttachedSessionRuntimeQueryState = (
  session: SessionRuntimeAccessState | null | undefined,
): SessionRuntimeQueryState => {
  const runtimeKind = session?.runtimeKind ?? null;
  const repoPath = session?.repoPath?.trim() ?? "";
  const workingDirectory = session?.workingDirectory?.trim() ?? "";

  return {
    runtimeQueryInput:
      runtimeKind && repoPath && workingDirectory
        ? {
            repoPath,
            runtimeKind,
            workingDirectory,
          }
        : null,
    runtimeQueryError: null,
  };
};
