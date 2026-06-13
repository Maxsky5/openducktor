import type { AgentSessionRef, AgentSessionRuntimeRef } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireSessionRuntimeKindForPersistence } from "./session-runtime-metadata";

export type ListenToAgentSession = (session: AgentSessionRef) => Promise<void>;

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
