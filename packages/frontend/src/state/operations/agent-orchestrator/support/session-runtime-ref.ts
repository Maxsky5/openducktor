import type { AgentSessionRecord } from "@openducktor/contracts";
import type {
  AgentSessionRef,
  AgentSessionRuntimeRef,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { requireRepoRuntimeRef, requireSessionWorkingDirectory } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { readPersistedSessionRuntimeKind } from "./session-runtime-kind";

export type ObserveAgentSession = (session: AgentSessionRef) => Promise<void>;
type RuntimeSessionContextSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "taskId" | "role" | "selectedModel"
>;

export const toRuntimeWorkingDirectoryRef = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  action,
}: {
  repoPath: string;
  runtimeKind: AgentSessionIdentity["runtimeKind"];
  workingDirectory: AgentSessionIdentity["workingDirectory"];
  action: string;
}): RuntimeWorkingDirectoryRef => {
  const runtimeRef = requireRepoRuntimeRef(
    {
      repoPath,
      runtimeKind,
    },
    action,
  );
  return {
    ...runtimeRef,
    workingDirectory: requireSessionWorkingDirectory(workingDirectory, action),
  };
};

export const toRuntimeSessionRef = (
  repoPath: string,
  session: AgentSessionIdentity,
): AgentSessionRef => {
  return {
    ...toRuntimeWorkingDirectoryRef({
      repoPath,
      runtimeKind: session.runtimeKind,
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
  ...toRuntimeWorkingDirectoryRef({
    repoPath,
    runtimeKind: readPersistedSessionRuntimeKind(record),
    workingDirectory: record.workingDirectory,
    action: `reach persisted session '${record.externalSessionId}'`,
  }),
  externalSessionId: record.externalSessionId,
});

export const toRuntimeSessionContextRef = (
  repoPath: string,
  session: RuntimeSessionContextSource,
): AgentSessionRuntimeRef => ({
  ...toRuntimeSessionRef(repoPath, session),
  taskId: session.taskId,
  role: session.role,
  ...(session.selectedModel ? { model: session.selectedModel } : {}),
});
