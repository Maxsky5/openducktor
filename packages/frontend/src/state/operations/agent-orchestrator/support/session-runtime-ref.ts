import type {
  AgentSessionRef,
  AgentSessionRuntimeRef,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireSessionRuntimeKindForPersistence } from "./session-runtime-metadata";

export type ListenToAgentSession = (session: AgentSessionRef) => Promise<void>;

export type RuntimeWorkingDirectoryAccessState = {
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
};

export type RuntimeWorkingDirectoryRefState = {
  runtimeRef: RuntimeWorkingDirectoryRef | null;
  runtimeRefError: string | null;
};

export const resolveRuntimeWorkingDirectoryRefState = ({
  repoPath,
  session,
}: {
  repoPath: string | null | undefined;
  session: RuntimeWorkingDirectoryAccessState | null | undefined;
}): RuntimeWorkingDirectoryRefState => {
  if (!session) {
    return {
      runtimeRef: null,
      runtimeRefError: null,
    };
  }

  const runtimeKind = session.runtimeKind ?? null;
  const workspaceRepoPath = repoPath?.trim() ?? "";
  const workingDirectory = session.workingDirectory.trim();

  if (!workspaceRepoPath) {
    return {
      runtimeRef: null,
      runtimeRefError: "Active session runtime context is missing workspace repo path.",
    };
  }

  if (!runtimeKind) {
    return {
      runtimeRef: null,
      runtimeRefError: "Active session runtime context is missing runtime kind.",
    };
  }

  if (!workingDirectory) {
    return {
      runtimeRef: null,
      runtimeRefError: "Active session runtime context is missing working directory.",
    };
  }

  return {
    runtimeRef: {
      repoPath: workspaceRepoPath,
      runtimeKind,
      workingDirectory,
    },
    runtimeRefError: null,
  };
};

export const toRuntimeSessionRef = (
  repoPath: string,
  session: AgentSessionState,
): AgentSessionRef => ({
  externalSessionId: session.externalSessionId,
  repoPath,
  runtimeKind: requireSessionRuntimeKindForPersistence(session),
  workingDirectory: session.workingDirectory,
});

export const toRuntimeSessionContextRef = (
  repoPath: string,
  session: AgentSessionState,
): AgentSessionRuntimeRef => ({
  ...toRuntimeSessionRef(repoPath, session),
  taskId: session.taskId,
  role: session.role,
  ...(session.selectedModel ? { model: session.selectedModel } : {}),
});
