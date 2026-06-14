import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentSessionRef,
  AgentSessionRuntimeRef,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  readPersistedRuntimeKind,
  requireSessionRuntimeKindForPersistence,
} from "./session-runtime-metadata";

export type ListenToAgentSession = (session: AgentSessionRef) => Promise<void>;

export type RuntimeWorkingDirectoryAccessState = {
  runtimeKind?: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
};

export type RuntimeWorkingDirectoryRefState = {
  runtimeRef: RuntimeWorkingDirectoryRef | null;
  runtimeRefError: string | null;
};

const toRuntimeWorkingDirectoryRefFromMetadata = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  action,
}: {
  repoPath: string | null | undefined;
  runtimeKind: AgentSessionState["runtimeKind"] | null | undefined;
  workingDirectory: string | null | undefined;
  action: string;
}): RuntimeWorkingDirectoryRef => {
  const runtimeRef = requireRepoRuntimeRef(
    {
      ...(repoPath !== null && repoPath !== undefined ? { repoPath } : {}),
      ...(runtimeKind ? { runtimeKind } : {}),
    },
    action,
  );
  return {
    ...runtimeRef,
    workingDirectory: requireSessionWorkingDirectory(workingDirectory, action),
  };
};

export const toRuntimeWorkingDirectoryRef = ({
  repoPath,
  session,
  action,
}: {
  repoPath: string | null | undefined;
  session: RuntimeWorkingDirectoryAccessState;
  action: string;
}): RuntimeWorkingDirectoryRef =>
  toRuntimeWorkingDirectoryRefFromMetadata({
    repoPath,
    runtimeKind: session.runtimeKind ?? null,
    workingDirectory: session.workingDirectory,
    action,
  });

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

  try {
    return {
      runtimeRef: toRuntimeWorkingDirectoryRef({
        repoPath,
        session,
        action: "read active session runtime data",
      }),
      runtimeRefError: null,
    };
  } catch (error) {
    return {
      runtimeRef: null,
      runtimeRefError: errorMessage(error),
    };
  }
};

export const toRuntimeSessionRef = (
  repoPath: string,
  session: AgentSessionState,
): AgentSessionRef => {
  const runtimeKind = requireSessionRuntimeKindForPersistence(session);
  return {
    ...toRuntimeWorkingDirectoryRefFromMetadata({
      repoPath,
      runtimeKind,
      workingDirectory: session.workingDirectory,
      action: `reach session '${session.externalSessionId}'`,
    }),
    externalSessionId: session.externalSessionId,
  };
};

export const toPersistedRuntimeSessionRef = ({
  repoPath,
  record,
}: {
  repoPath: string;
  record: AgentSessionRecord;
}): AgentSessionRef => ({
  ...toRuntimeWorkingDirectoryRefFromMetadata({
    repoPath,
    runtimeKind: readPersistedRuntimeKind(record),
    workingDirectory: record.workingDirectory,
    action: `reach persisted session '${record.externalSessionId}'`,
  }),
  externalSessionId: record.externalSessionId,
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
