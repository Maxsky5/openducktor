import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionRuntimeAccessState = {
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

export const resolveSessionRuntimeQueryState = ({
  repoPath,
  session,
}: {
  repoPath: string | null | undefined;
  session: SessionRuntimeAccessState | null | undefined;
}): SessionRuntimeQueryState => {
  if (!session) {
    return {
      runtimeQueryInput: null,
      runtimeQueryError: null,
    };
  }

  const runtimeKind = session?.runtimeKind ?? null;
  const workspaceRepoPath = repoPath?.trim() ?? "";
  const workingDirectory = session?.workingDirectory?.trim() ?? "";

  if (!workspaceRepoPath) {
    return {
      runtimeQueryInput: null,
      runtimeQueryError: "Active session runtime context is missing workspace repo path.",
    };
  }

  if (!runtimeKind) {
    return {
      runtimeQueryInput: null,
      runtimeQueryError: "Active session runtime context is missing runtime kind.",
    };
  }

  if (!workingDirectory) {
    return {
      runtimeQueryInput: null,
      runtimeQueryError: "Active session runtime context is missing working directory.",
    };
  }

  return {
    runtimeQueryInput: {
      repoPath: workspaceRepoPath,
      runtimeKind,
      workingDirectory,
    },
    runtimeQueryError: null,
  };
};
