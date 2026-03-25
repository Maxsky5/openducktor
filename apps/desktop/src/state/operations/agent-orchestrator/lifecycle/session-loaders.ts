import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelCatalog,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { normalizeWorkingDirectory } from "../support/core";
import {
  coerceSessionSelectionToCatalog,
  pickDefaultSessionSelectionForCatalog,
} from "../support/models";
import { mergeTodoListPreservingOrder } from "../support/todos";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionLoadersAdapter = Pick<AgentEnginePort, "listAvailableModels" | "loadSessionTodos">;

type CreateSessionLoadersArgs = {
  adapter: SessionLoadersAdapter;
  supportsSessionTodos?: (runtimeKind: RuntimeKind) => boolean;
  updateSession: UpdateSession;
};

const LOCAL_RUNTIME_HOSTS = new Set(["127.0.0.1", "localhost"]);

const validateLocalRuntimeBaseUrl = (runtimeEndpoint: string): string => {
  const trimmedBaseUrl = runtimeEndpoint.trim();
  if (trimmedBaseUrl.length === 0) {
    throw new Error("Session runtime runtimeEndpoint is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedBaseUrl);
  } catch {
    throw new Error(`Session runtime runtimeEndpoint is invalid: ${trimmedBaseUrl}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error("Session runtime runtimeEndpoint must use the http protocol.");
  }

  if (!LOCAL_RUNTIME_HOSTS.has(parsed.hostname)) {
    throw new Error("Session runtime runtimeEndpoint must target localhost or 127.0.0.1.");
  }

  const numericPort = Number(parsed.port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error("Session runtime runtimeEndpoint must include a valid port.");
  }

  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error(
      "Session runtime runtimeEndpoint must not include credentials, query, hash, or path.",
    );
  }

  return trimmedBaseUrl;
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

const validateRuntimeConnection = (
  runtimeConnection: AgentRuntimeConnection,
): AgentRuntimeConnection => ({
  endpoint: validateLocalRuntimeBaseUrl(runtimeConnection.endpoint ?? ""),
  workingDirectory: validateWorkingDirectory(runtimeConnection.workingDirectory),
});

const toRuntimeLoadKey = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
): string =>
  `${runtimeKind}::${runtimeConnection.endpoint ?? ""}::${normalizeWorkingDirectory(runtimeConnection.workingDirectory)}`;

export const createLoadSessionModelCatalog = ({
  adapter,
  updateSession,
}: CreateSessionLoadersArgs): ((
  sessionId: string,
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
) => Promise<void>) => {
  const inFlightCatalogByRuntimeKey = new Map<string, Promise<AgentModelCatalog>>();
  const catalogByRuntimeKey = new Map<string, AgentModelCatalog>();

  return async (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ): Promise<void> => {
    updateSession(
      sessionId,
      (current) => ({
        ...current,
        isLoadingModelCatalog: true,
      }),
      { persist: false },
    );

    let catalog: AgentModelCatalog | null = null;
    try {
      const validatedRuntimeConnection = validateRuntimeConnection(runtimeConnection);
      const runtimeKey = toRuntimeLoadKey(runtimeKind, validatedRuntimeConnection);
      const cachedCatalog = catalogByRuntimeKey.get(runtimeKey);
      if (cachedCatalog) {
        catalog = cachedCatalog;
      } else {
        let inFlightCatalog = inFlightCatalogByRuntimeKey.get(runtimeKey);
        if (!inFlightCatalog) {
          inFlightCatalog = adapter
            .listAvailableModels({
              runtimeKind,
              runtimeConnection: validatedRuntimeConnection,
            })
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
        sessionId,
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
  sessionId: string,
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  externalSessionId: string,
) => Promise<void>) => {
  const inFlightTodosBySessionKey = new Map<string, Promise<AgentSessionTodoItem[]>>();

  return async (
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ): Promise<void> => {
    if (!supportsSessionTodos(runtimeKind)) {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          todos: [],
        }),
        { persist: false },
      );
      return;
    }
    const validatedRuntimeConnection = validateRuntimeConnection(runtimeConnection);
    const sessionKey = `${toRuntimeLoadKey(runtimeKind, validatedRuntimeConnection)}::${externalSessionId}`;
    let inFlightTodos = inFlightTodosBySessionKey.get(sessionKey);
    if (!inFlightTodos) {
      inFlightTodos = adapter
        .loadSessionTodos({
          runtimeKind,
          runtimeConnection: validatedRuntimeConnection,
          externalSessionId,
        })
        .finally(() => {
          inFlightTodosBySessionKey.delete(sessionKey);
        });
      inFlightTodosBySessionKey.set(sessionKey, inFlightTodos);
    }
    const todos = await inFlightTodos;
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
