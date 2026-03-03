import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  mergeTodoListPreservingOrder,
  normalizeSelectionForCatalog,
  now,
  pickDefaultModel,
  upsertMessage,
} from "../support/utils";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionLoadersAdapter = Pick<AgentEnginePort, "listAvailableModels" | "loadSessionTodos">;

type CreateSessionLoadersArgs = {
  adapter: SessionLoadersAdapter;
  updateSession: UpdateSession;
};

export const createLoadSessionModelCatalog = ({
  adapter,
  updateSession,
}: CreateSessionLoadersArgs): ((
  sessionId: string,
  baseUrl: string,
  workingDirectory: string,
) => Promise<void>) => {
  return async (sessionId: string, baseUrl: string, workingDirectory: string): Promise<void> => {
    updateSession(
      sessionId,
      (current) => ({
        ...current,
        isLoadingModelCatalog: true,
      }),
      { persist: false },
    );

    try {
      const catalog = await adapter.listAvailableModels({
        baseUrl,
        workingDirectory,
      });
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          modelCatalog: catalog,
          selectedModel:
            normalizeSelectionForCatalog(catalog, current.selectedModel) ??
            pickDefaultModel(catalog),
          isLoadingModelCatalog: false,
        }),
        { persist: false },
      );
    } catch (error) {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          isLoadingModelCatalog: false,
          messages: upsertMessage(current.messages, {
            id: `model-catalog:${sessionId}`,
            role: "system",
            content: `Model catalog unavailable: ${errorMessage(error)}`,
            timestamp: now(),
          }),
        }),
        { persist: false },
      );
    }
  };
};

export const createLoadSessionTodos = ({
  adapter,
  updateSession,
}: CreateSessionLoadersArgs): ((
  sessionId: string,
  baseUrl: string,
  workingDirectory: string,
  externalSessionId: string,
) => Promise<void>) => {
  return async (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ): Promise<void> => {
    const todos = await adapter.loadSessionTodos({
      baseUrl,
      workingDirectory,
      externalSessionId,
    });
    updateSession(
      sessionId,
      (current) => ({
        ...current,
        todos: mergeTodoListPreservingOrder(current.todos, todos),
      }),
      { persist: false },
    );
  };
};
