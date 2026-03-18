import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRole, AgentRuntimeConnection } from "@openducktor/core";
import { runOrchestratorSideEffect } from "./async-side-effects";

export type SessionOrchestrationContext = {
  repoPath: string;
  sessionId: string;
  taskId: string;
  role: AgentRole;
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  externalSessionId: string;
};

export type SessionWarmupDependencies = {
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
};

export type SessionWarmupOptions = {
  operationPrefix: string;
  shouldLoadModelCatalog?: boolean;
};

export const warmSessionData = (
  context: SessionOrchestrationContext,
  {
    loadSessionTodos,
    loadSessionModelCatalog,
  }: SessionWarmupDependencies,
  {
    operationPrefix,
    shouldLoadModelCatalog = true,
  }: SessionWarmupOptions,
): void => {
  const {
    repoPath,
    sessionId,
    taskId,
  role,
    runtimeKind,
    runtimeConnection,
    externalSessionId,
  } = context;
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
