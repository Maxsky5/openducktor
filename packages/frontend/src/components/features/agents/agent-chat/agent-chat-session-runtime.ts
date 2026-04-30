import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type SessionRuntimeAccessState = {
  repoPath?: string | null;
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
};

export type AgentChatSessionRuntimeQueryInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
};

export type AgentChatSessionRuntimeQueryState = {
  runtimeQueryInput: AgentChatSessionRuntimeQueryInput | null;
  runtimeQueryError: string | null;
};

export const resolveAttachedSessionRuntimeQueryState = (
  session: SessionRuntimeAccessState | null | undefined,
): AgentChatSessionRuntimeQueryState => {
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
