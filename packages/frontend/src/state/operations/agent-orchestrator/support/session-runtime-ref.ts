import type { AgentSessionRef, AgentSessionRuntimeRef } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireSessionRuntimeKindForPersistence } from "./session-runtime-metadata";

export type ListenToAgentSession = (session: AgentSessionRef) => void;

export const toRuntimeSessionRef = (session: AgentSessionState): AgentSessionRef => ({
  externalSessionId: session.externalSessionId,
  repoPath: session.repoPath,
  runtimeKind: requireSessionRuntimeKindForPersistence(session),
  workingDirectory: session.workingDirectory,
});

export const toRuntimeSessionContextRef = (session: AgentSessionState): AgentSessionRuntimeRef => ({
  ...toRuntimeSessionRef(session),
  taskId: session.taskId,
  role: session.role,
  ...(session.selectedModel ? { model: session.selectedModel } : {}),
});
