import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { normalizeWorkingDirectory } from "../support/core";
import {
  coerceSessionSelectionToCatalog,
  pickDefaultSessionSelectionForCatalog,
} from "../support/models";
import { mergeTodoListPreservingOrder } from "../support/todos";

type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionLoadersAdapter = Pick<AgentEnginePort, "listAvailableModels" | "loadSessionTodos">;

type CreateSessionLoadersArgs = {
  adapter: SessionLoadersAdapter;
  supportsSessionTodos?: (runtimeKind: RuntimeKind) => boolean;
  updateSession: UpdateSession;
};

const validateWorkingDirectory = (workingDirectory: string): string => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
  if (normalizedWorkingDirectory.length === 0) {
    throw new Error("Session runtime workingDirectory is required.");
  }

  if (!normalizedWorkingDirectory.startsWith("/")) {
    throw new Error("Session runtime workingDirectory must be an absolute path.");
  }

  if (normalizedWorkingDirectory.includes("\u0000")) {
    throw new Error("Session runtime workingDirectory contains an invalid null byte.");
  }

  const containsTraversalSegment = normalizedWorkingDirectory
    .split("/")
    .some((segment) => segment === "." || segment === "..");
  if (containsTraversalSegment) {
    throw new Error("Session runtime workingDirectory must not contain traversal segments.");
  }

  return normalizedWorkingDirectory;
};

const toRuntimeLoadKey = (repoPath: string, runtimeKind: RuntimeKind): string =>
  `${normalizeWorkingDirectory(repoPath)}::${runtimeKind}`;

const toSessionLoadKey = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
): string =>
  `${toRuntimeLoadKey(repoPath, runtimeKind)}::${validateWorkingDirectory(workingDirectory)}`;

export const createLoadSessionModelCatalog = ({
  adapter,
  updateSession,
}: CreateSessionLoadersArgs): ((
  externalSessionId: string,
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
) => Promise<void>) => {
  const inFlightCatalogByRuntimeKey = new Map<string, Promise<AgentModelCatalog>>();
  const catalogByRuntimeKey = new Map<string, AgentModelCatalog>();

  return async (
    externalSessionId: string,
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): Promise<void> => {
    updateSession(
      externalSessionId,
      (current) => ({
        ...current,
        isLoadingModelCatalog: true,
      }),
      { persist: false },
    );

    let catalog: AgentModelCatalog | null = null;
    try {
      validateWorkingDirectory(workingDirectory);
      const runtimeKey = toRuntimeLoadKey(repoPath, runtimeKind);
      const cachedCatalog = catalogByRuntimeKey.get(runtimeKey);
      if (cachedCatalog) {
        catalog = cachedCatalog;
      } else {
        let inFlightCatalog = inFlightCatalogByRuntimeKey.get(runtimeKey);
        if (!inFlightCatalog) {
          inFlightCatalog = adapter
            .listAvailableModels({ repoPath, runtimeKind })
            .then((loadedCatalog) => {
              catalogByRuntimeKey.set(runtimeKey, loadedCatalog);
              return loadedCatalog;
            })
            .finally(() => {
              inFlightCatalogByRuntimeKey.delete(runtimeKey);
            });
          inFlightCatalogByRuntimeKey.set(runtimeKey, inFlightCatalog);
        }
        catalog = await inFlightCatalog;
      }
    } finally {
      updateSession(
        externalSessionId,
        (current) => ({
          ...current,
          ...(catalog
            ? {
                modelCatalog: catalog,
                selectedModel:
                  coerceSessionSelectionToCatalog(catalog, current.selectedModel) ??
                  pickDefaultSessionSelectionForCatalog(catalog),
              }
            : {}),
          isLoadingModelCatalog: false,
        }),
        { persist: false },
      );
    }
  };
};

export const createLoadSessionTodos = ({
  adapter,
  supportsSessionTodos = () => true,
  updateSession,
}: CreateSessionLoadersArgs): ((
  externalSessionId: string,
  repoPath: string,
  runtimeKind: RuntimeKind,
  workingDirectory: string,
) => Promise<void>) => {
  const inFlightTodosBySessionKey = new Map<string, Promise<AgentSessionTodoItem[]>>();

  return async (
    externalSessionId: string,
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): Promise<void> => {
    if (!supportsSessionTodos(runtimeKind)) {
      updateSession(
        externalSessionId,
        (current) => ({
          ...current,
          todos: [],
        }),
        { persist: false },
      );
      return;
    }
    const normalizedWorkingDirectory = validateWorkingDirectory(workingDirectory);
    const sessionKey = `${toSessionLoadKey(repoPath, runtimeKind, normalizedWorkingDirectory)}::${externalSessionId}`;
    let inFlightTodos = inFlightTodosBySessionKey.get(sessionKey);
    if (!inFlightTodos) {
      inFlightTodos = adapter
        .loadSessionTodos({
          repoPath,
          runtimeKind,
          workingDirectory: normalizedWorkingDirectory,
          externalSessionId,
        })
        .finally(() => {
          inFlightTodosBySessionKey.delete(sessionKey);
        });
      inFlightTodosBySessionKey.set(sessionKey, inFlightTodos);
    }
    const todos = await inFlightTodos;
    updateSession(
      externalSessionId,
      (current) => ({
        ...current,
        todos: mergeTodoListPreservingOrder(current.todos, todos),
      }),
      { persist: false },
    );
  };
};
