import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRole, AgentRuntimeConnection } from "@openducktor/core";
import { runOrchestratorSideEffect } from "./async-side-effects";

export type SessionWarmupInput = {
  operationPrefix: string;
  repoPath: string;
  sessionId: string;
  taskId: string;
  role: AgentRole;
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  externalSessionId: string;
  loadSessionTodos: (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<void>;
  shouldLoadModelCatalog?: boolean;
};

export const warmSessionData = ({
  operationPrefix,
  repoPath,
  sessionId,
  taskId,
  role,
  runtimeKind,
  runtimeConnection,
  externalSessionId,
  loadSessionTodos,
  loadSessionModelCatalog,
  shouldLoadModelCatalog = true,
}: SessionWarmupInput): void => {
  const baseTags = {
    repoPath,
    sessionId,
    taskId,
    role,
  };

  runOrchestratorSideEffect(
    `${operationPrefix}-todos`,
    loadSessionTodos(sessionId, runtimeKind, runtimeConnection, externalSessionId),
    {
      tags: {
        ...baseTags,
        externalSessionId,
      },
    },
  );

  if (!shouldLoadModelCatalog) {
    return;
  }

  runOrchestratorSideEffect(
    `${operationPrefix}-model-catalog`,
    loadSessionModelCatalog(sessionId, runtimeKind, runtimeConnection),
    { tags: baseTags },
  );
};
