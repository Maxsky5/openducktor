import {
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  type RuntimeInstanceSummary,
  type RuntimeRoute,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeMcpStatusProbeInput,
  RuntimeMcpStatusProbeResult,
  RuntimeRegistryError,
  RuntimeSessionStatusProbeInput,
  RuntimeSessionStopInput,
} from "../../ports/runtime-registry-port";

const SESSION_REQUEST_TIMEOUT_MS = 2000;
const MCP_REQUEST_TIMEOUT_MS = 2000;
const MAX_ABORT_ERROR_BODY_BYTES = 64 * 1024;
const CODEX_ODT_TOOL_IDS = [...ODT_WORKFLOW_AGENT_TOOL_NAMES];

const requireOpenCodeLocalHttpEndpoint = (runtimeRoute: RuntimeRoute, operation: string) =>
  Effect.gen(function* () {
    if (runtimeRoute.type !== "local_http") {
      return yield* Effect.fail(
        new HostValidationError({
          message: `OpenCode ${operation} requires a local_http runtime route.`,
          field: "runtimeRoute.type",
          details: { operation, routeType: runtimeRoute.type },
        }),
      );
    }
    const endpoint = yield* Effect.try({
      try: () => new URL(runtimeRoute.endpoint),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: { operation, endpoint: runtimeRoute.endpoint },
        }),
    });
    const host = endpoint.hostname.toLowerCase();
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!isLoopback) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `OpenCode ${operation} requires a loopback runtime endpoint.`,
          field: "runtimeRoute.endpoint",
          details: { operation, endpoint: runtimeRoute.endpoint },
        }),
      );
    }
    return endpoint;
  });

const sessionEndpoint = (endpoint: URL, routePath: string, workingDirectory: string): URL => {
  const url = new URL(routePath, endpoint);
  url.searchParams.set("directory", workingDirectory);
  return url;
};

const mcpEndpoint = (endpoint: URL, routePath: string, workingDirectory: string): URL => {
  const url = new URL(routePath, endpoint);
  url.searchParams.set("directory", workingDirectory);
  return url;
};

const isLiveSessionStatus = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const status = (value as Record<string, unknown>).type;
  return status === "busy" || status === "retry";
};

export const runtimeEnsureFlightKey = (runtimeKind: string, repoPath: string): string =>
  `${runtimeKind}::${repoPath}`;

const requireObjectPayload = (value: unknown, context: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Effect.fail(
      new HostValidationError({
        message: `${context} must be an object`,
        details: { context },
      }),
    );
  }
  return Effect.succeed(value as Record<string, unknown>);
};

const readStringProperty = (value: Record<string, unknown>, property: string): string | null => {
  const raw = value[property];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
};

const parseToolIds = (payload: unknown) => {
  if (!Array.isArray(payload)) {
    return Effect.fail(
      new HostValidationError({
        message: "OpenCode tool id payload must be an array",
        details: { payloadType: typeof payload },
      }),
    );
  }
  return Effect.succeed(
    Array.from(
      new Set(
        payload.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
      ),
    ),
  );
};

export const findWorkspaceRuntime = (
  runtimes: Iterable<RuntimeInstanceSummary>,
  input: RuntimeEnsureWorkspaceInput,
): RuntimeInstanceSummary | undefined => {
  for (const runtime of runtimes) {
    if (
      runtime.kind === input.runtimeKind &&
      runtime.repoPath === input.repoPath &&
      runtime.role === "workspace"
    ) {
      return runtime;
    }
  }
  return undefined;
};

const readBoundedResponseText = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => toHostOperationError(cause, "runtimeRegistry.readResponseText"),
  }).pipe(
    Effect.map((text) =>
      text.length > MAX_ABORT_ERROR_BODY_BYTES ? text.slice(0, MAX_ABORT_ERROR_BODY_BYTES) : text,
    ),
  );

export const stopOpenCodeSession = ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionStopInput) =>
  Effect.gen(function* () {
    const endpoint = yield* requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session abort");
    const url = sessionEndpoint(
      endpoint,
      `/session/${encodeURIComponent(externalSessionId)}/abort`,
      workingDirectory,
    );
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        toHostOperationError(cause, "runtimeRegistry.stopOpenCodeSession", {
          externalSessionId,
          workingDirectory,
          url: url.toString(),
        }),
    });
    if (response.ok) {
      return;
    }
    const detail = (yield* readBoundedResponseText(response)).trim();
    if (!detail) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "runtimeRegistry.stopOpenCodeSession",
          message: `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}`,
          details: { externalSessionId, status: response.status },
        }),
      );
    }
    return yield* Effect.fail(
      new HostOperationError({
        operation: "runtimeRegistry.stopOpenCodeSession",
        message: `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}: ${detail}`,
        details: { externalSessionId, status: response.status, detail },
      }),
    );
  });

export const probeOpenCodeSessionStatus = ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionStatusProbeInput): Effect.Effect<
  {
    supported: boolean;
    hasLiveSession: boolean;
  },
  RuntimeRegistryError
> =>
  Effect.gen(function* () {
    if (runtimeRoute.type !== "local_http") {
      return { supported: false, hasLiveSession: false };
    }
    const endpoint = yield* requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session status probe");
    const url = sessionEndpoint(endpoint, "/session/status", workingDirectory);
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        toHostOperationError(cause, "runtimeRegistry.probeOpenCodeSessionStatus", {
          workingDirectory,
          url: url.toString(),
        }),
    });
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => toHostOperationError(cause, "runtimeRegistry.readSessionStatusResponse"),
    });
    if (!response.ok) {
      const detail = body.trim();
      return yield* Effect.fail(
        new HostOperationError({
          operation: "runtimeRegistry.probeOpenCodeSessionStatus",
          message: detail
            ? `OpenCode session status probe failed with status ${response.status}: ${detail}`
            : `OpenCode session status probe failed with status ${response.status}`,
          details: { status: response.status, detail },
        }),
      );
    }
    const statuses = yield* Effect.try({
      try: () => JSON.parse(body) as Record<string, unknown>,
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: { operation: "runtimeRegistry.parseSessionStatusResponse" },
        }),
    });
    return {
      supported: true,
      hasLiveSession: isLiveSessionStatus(statuses[externalSessionId]),
    };
  });

const fetchOpenCodeJson = (
  runtimeRoute: RuntimeRoute,
  operation: string,
  method: "GET" | "POST",
  routePath: string,
  workingDirectory: string,
) =>
  Effect.gen(function* () {
    const endpoint = yield* requireOpenCodeLocalHttpEndpoint(runtimeRoute, operation);
    const url = mcpEndpoint(endpoint, routePath, workingDirectory);
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method,
          signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        toHostOperationError(cause, `runtimeRegistry.fetchOpenCodeJson.${operation}`, {
          operation,
          method,
          path: routePath,
          workingDirectory,
          url: url.toString(),
        }),
    });
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => toHostOperationError(cause, "runtimeRegistry.readOpenCodeJsonResponse"),
    });
    if (!response.ok) {
      const detail = body.trim();
      return yield* Effect.fail(
        new HostOperationError({
          operation: `runtimeRegistry.fetchOpenCodeJson.${operation}`,
          message: detail
            ? `OpenCode ${operation} failed with status ${response.status}: ${detail}`
            : `OpenCode ${operation} failed with status ${response.status}`,
          details: { status: response.status, detail, path: routePath, workingDirectory },
        }),
      );
    }
    if (body.trim().length === 0) {
      return null;
    }
    return yield* Effect.try({
      try: () => parseJson(body),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: {
            operation: `runtimeRegistry.parseOpenCodeJson.${operation}`,
            path: routePath,
            workingDirectory,
          },
        }),
    });
  });

export const probeOpenCodeMcpStatus = ({
  runtimeRoute,
  workingDirectory,
  serverName,
}: {
  runtimeRoute: RuntimeRoute;
  workingDirectory: string;
  serverName: string;
}) =>
  Effect.gen(function* () {
    if (runtimeRoute.type !== "local_http") {
      return {
        supported: false,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: null,
        failureKind: null,
      };
    }
    const statusPayload = yield* requireObjectPayload(
      yield* fetchOpenCodeJson(runtimeRoute, "load MCP status", "GET", "/mcp", workingDirectory),
      "OpenCode MCP status payload",
    );
    const rawServer = statusPayload[serverName];
    if (!rawServer) {
      return {
        supported: true,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: `MCP server ${serverName} was not reported by the runtime.`,
        failureKind: "error" as const,
      };
    }
    const server = yield* requireObjectPayload(rawServer, `OpenCode MCP status for ${serverName}`);
    const status = readStringProperty(server, "status");
    if (!status) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `OpenCode MCP status for ${serverName} is missing status`,
          field: "status",
          details: { serverName },
        }),
      );
    }
    const error = readStringProperty(server, "error");
    if (status !== "connected") {
      return {
        supported: true,
        connected: false,
        serverStatus: status,
        toolIds: [],
        detail: error ?? `MCP server ${serverName} status is ${status}.`,
        failureKind: "error" as const,
      };
    }
    const toolIds = yield* parseToolIds(
      yield* fetchOpenCodeJson(
        runtimeRoute,
        "load tool ids",
        "GET",
        "/experimental/tool/ids",
        workingDirectory,
      ),
    );
    return {
      supported: true,
      connected: true,
      serverStatus: status,
      toolIds,
      detail: null,
      failureKind: null,
    };
  });

export const probeCodexMcpStatus = ({
  runtimeRoute,
  serverName,
}: RuntimeMcpStatusProbeInput): RuntimeMcpStatusProbeResult => {
  if (runtimeRoute.type !== "stdio") {
    return {
      supported: false,
      connected: false,
      serverStatus: null,
      toolIds: [],
      detail: "Codex MCP status probing requires a host-managed stdio app-server runtime.",
      failureKind: "error",
    };
  }
  if (serverName !== "openducktor") {
    return {
      supported: true,
      connected: false,
      serverStatus: null,
      toolIds: [],
      detail: `MCP server ${serverName} is not configured for Codex app-server runtimes.`,
      failureKind: "error",
    };
  }
  return {
    supported: true,
    connected: true,
    serverStatus: "connected",
    toolIds: CODEX_ODT_TOOL_IDS,
    detail: null,
    failureKind: null,
  };
};
