import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRuntimeConnection } from "@openducktor/core";
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
  const trimmedWorkingDirectory = workingDirectory.trim();
  if (trimmedWorkingDirectory.length === 0) {
    throw new Error("Session runtime workingDirectory is required.");
  }

  if (!trimmedWorkingDirectory.startsWith("/")) {
    throw new Error("Session runtime workingDirectory must be an absolute path.");
  }

  if (trimmedWorkingDirectory.includes("\u0000")) {
    throw new Error("Session runtime workingDirectory contains an invalid null byte.");
  }

  const containsTraversalSegment = trimmedWorkingDirectory
    .split("/")
    .some((segment) => segment === "." || segment === "..");
  if (containsTraversalSegment) {
    throw new Error("Session runtime workingDirectory must not contain traversal segments.");
  }

  return trimmedWorkingDirectory;
};

const validateRuntimeConnection = (
  runtimeConnection: AgentRuntimeConnection,
): AgentRuntimeConnection => ({
  endpoint: validateLocalRuntimeBaseUrl(runtimeConnection.endpoint ?? ""),
  workingDirectory: validateWorkingDirectory(runtimeConnection.workingDirectory),
});

export const createLoadSessionModelCatalog = ({
  adapter,
  updateSession,
}: CreateSessionLoadersArgs): ((
  sessionId: string,
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
) => Promise<void>) => {
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

    try {
      const validatedRuntimeConnection = validateRuntimeConnection(runtimeConnection);
      const catalog = await adapter.listAvailableModels({
        runtimeKind,
        runtimeConnection: validatedRuntimeConnection,
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
  supportsSessionTodos = () => true,
  updateSession,
}: CreateSessionLoadersArgs): ((
  sessionId: string,
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  externalSessionId: string,
) => Promise<void>) => {
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
    const todos = await adapter.loadSessionTodos({
      runtimeKind,
      runtimeConnection: validatedRuntimeConnection,
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
