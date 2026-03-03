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

const LOCAL_RUNTIME_HOSTS = new Set(["127.0.0.1", "localhost"]);

const validateLocalRuntimeBaseUrl = (baseUrl: string): string => {
  const trimmedBaseUrl = baseUrl.trim();
  if (trimmedBaseUrl.length === 0) {
    throw new Error("Session runtime baseUrl is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedBaseUrl);
  } catch {
    throw new Error(`Session runtime baseUrl is invalid: ${trimmedBaseUrl}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error("Session runtime baseUrl must use the http protocol.");
  }

  if (!LOCAL_RUNTIME_HOSTS.has(parsed.hostname)) {
    throw new Error("Session runtime baseUrl must target localhost or 127.0.0.1.");
  }

  const numericPort = Number(parsed.port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error("Session runtime baseUrl must include a valid port.");
  }

  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("Session runtime baseUrl must not include credentials, query, hash, or path.");
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

const validateRuntimeInput = (baseUrl: string, workingDirectory: string) => ({
  baseUrl: validateLocalRuntimeBaseUrl(baseUrl),
  workingDirectory: validateWorkingDirectory(workingDirectory),
});

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
      const runtimeInput = validateRuntimeInput(baseUrl, workingDirectory);
      const catalog = await adapter.listAvailableModels(runtimeInput);
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
    const runtimeInput = validateRuntimeInput(baseUrl, workingDirectory);
    const todos = await adapter.loadSessionTodos({
      ...runtimeInput,
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
