import {
  type RuntimeInstanceSummary,
  type RuntimeRoute,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeMcpStatusProbeInput,
  RuntimeMcpStatusProbeResult,
  RuntimeRegistryPort,
  RuntimeSessionStatusProbeInput,
  RuntimeSessionStopInput,
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../ports/runtime-registry-port";

export type CreateInMemoryRuntimeRegistryPortInput = {
  runtimes?: RuntimeInstanceSummary[];
  workspaceStarter?: RuntimeWorkspaceStarterPort;
};

const SESSION_REQUEST_TIMEOUT_MS = 2_000;
const MCP_REQUEST_TIMEOUT_MS = 2_000;
const MAX_ABORT_ERROR_BODY_BYTES = 64 * 1024;
const CODEX_ODT_TOOL_IDS = [
  "odt_read_task",
  "odt_read_task_documents",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_set_pull_request",
  "odt_qa_approved",
  "odt_qa_rejected",
];

const requireOpenCodeLocalHttpEndpoint = (runtimeRoute: RuntimeRoute, operation: string): URL => {
  if (runtimeRoute.type !== "local_http") {
    throw new Error(`OpenCode ${operation} requires a local_http runtime route.`);
  }

  const endpoint = new URL(runtimeRoute.endpoint);
  const host = endpoint.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLoopback) {
    throw new Error(`OpenCode ${operation} requires a loopback runtime endpoint.`);
  }

  return endpoint;
};

const sessionEndpoint = (endpoint: URL, path: string, workingDirectory: string): URL => {
  const url = new URL(path, endpoint);
  url.searchParams.set("directory", workingDirectory);
  return url;
};

const mcpEndpoint = (endpoint: URL, path: string, workingDirectory: string): URL => {
  const url = new URL(path, endpoint);
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

const runtimeEnsureFlightKey = (runtimeKind: string, repoPath: string): string =>
  `${runtimeKind}::${repoPath}`;

const requireObjectPayload = (value: unknown, context: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
};

const readStringProperty = (value: Record<string, unknown>, property: string): string | null => {
  const raw = value[property];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
};

const parseToolIds = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    throw new Error("OpenCode tool id payload must be an array");
  }
  return Array.from(
    new Set(
      payload.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
    ),
  );
};

const findWorkspaceRuntime = (
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

const readBoundedResponseText = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (text.length > MAX_ABORT_ERROR_BODY_BYTES) {
    return text.slice(0, MAX_ABORT_ERROR_BODY_BYTES);
  }
  return text;
};

const stopOpenCodeSession = async ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionStopInput): Promise<void> => {
  const endpoint = requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session abort");
  const url = sessionEndpoint(
    endpoint,
    `/session/${encodeURIComponent(externalSessionId)}/abort`,
    workingDirectory,
  );
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(`Failed to abort OpenCode session ${externalSessionId}`, { cause: error });
  });

  if (response.ok) {
    return;
  }

  const detail = (await readBoundedResponseText(response)).trim();
  if (!detail) {
    throw new Error(
      `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}`,
    );
  }
  throw new Error(
    `OpenCode runtime rejected abort for session ${externalSessionId} with status ${response.status}: ${detail}`,
  );
};

const probeOpenCodeSessionStatus = async ({
  runtimeRoute,
  externalSessionId,
  workingDirectory,
}: RuntimeSessionStatusProbeInput): Promise<{ supported: boolean; hasLiveSession: boolean }> => {
  if (runtimeRoute.type !== "local_http") {
    return { supported: false, hasLiveSession: false };
  }
  const endpoint = requireOpenCodeLocalHttpEndpoint(runtimeRoute, "session status probe");
  const url = sessionEndpoint(endpoint, "/session/status", workingDirectory);
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(`Failed to inspect OpenCode session status for ${workingDirectory}`, {
      cause: error,
    });
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim();
    throw new Error(
      detail
        ? `OpenCode session status probe failed with status ${response.status}: ${detail}`
        : `OpenCode session status probe failed with status ${response.status}`,
    );
  }

  const statuses = JSON.parse(body) as Record<string, unknown>;
  return {
    supported: true,
    hasLiveSession: isLiveSessionStatus(statuses[externalSessionId]),
  };
};

const fetchOpenCodeJson = async (
  runtimeRoute: RuntimeRoute,
  operation: string,
  method: "GET" | "POST",
  path: string,
  workingDirectory: string,
): Promise<unknown> => {
  const endpoint = requireOpenCodeLocalHttpEndpoint(runtimeRoute, operation);
  const url = mcpEndpoint(endpoint, path, workingDirectory);
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(`Failed to ${operation}`, { cause: error });
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim();
    throw new Error(
      detail
        ? `OpenCode ${operation} failed with status ${response.status}: ${detail}`
        : `OpenCode ${operation} failed with status ${response.status}`,
    );
  }
  if (body.trim().length === 0) {
    return null;
  }
  return JSON.parse(body) as unknown;
};

const probeOpenCodeMcpStatus = async ({
  runtimeRoute,
  workingDirectory,
  serverName,
}: {
  runtimeRoute: RuntimeRoute;
  workingDirectory: string;
  serverName: string;
}) => {
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

  const statusPayload = requireObjectPayload(
    await fetchOpenCodeJson(runtimeRoute, "load MCP status", "GET", "/mcp", workingDirectory),
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

  const server = requireObjectPayload(rawServer, `OpenCode MCP status for ${serverName}`);
  const status = readStringProperty(server, "status");
  if (!status) {
    throw new Error(`OpenCode MCP status for ${serverName} is missing status`);
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

  const toolIds = parseToolIds(
    await fetchOpenCodeJson(
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
};

const probeCodexMcpStatus = ({
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

export const createInMemoryRuntimeRegistryPort = ({
  runtimes = [],
  workspaceStarter,
}: CreateInMemoryRuntimeRegistryPortInput = {}): RuntimeRegistryPort => {
  const entries = new Map(runtimes.map((runtime) => [runtime.runtimeId, runtime]));
  const handles = new Map<string, RuntimeWorkspaceHandle>();
  const ensureFlights = new Map<string, Promise<RuntimeInstanceSummary>>();

  return {
    async ensureWorkspaceRuntime(input) {
      const existingRuntime = findWorkspaceRuntime(entries.values(), input);
      if (existingRuntime) {
        return runtimeInstanceSummarySchema.parse(existingRuntime);
      }

      if (!workspaceStarter) {
        throw new Error(
          `Runtime kind ${input.runtimeKind} workspace startup is not configured in the TypeScript host.`,
        );
      }

      const flightKey = runtimeEnsureFlightKey(input.runtimeKind, input.repoPath);
      const existingFlight = ensureFlights.get(flightKey);
      if (existingFlight) {
        return existingFlight;
      }

      const flight = workspaceStarter
        .startWorkspaceRuntime(input)
        .then((handle) => {
          const parsed = runtimeInstanceSummarySchema.parse(handle.runtime);
          entries.set(parsed.runtimeId, parsed);
          handles.set(parsed.runtimeId, handle);
          return parsed;
        })
        .finally(() => {
          ensureFlights.delete(flightKey);
        });
      ensureFlights.set(flightKey, flight);
      return flight;
    },
    async listRuntimes() {
      return [...entries.values()];
    },
    async stopRuntime(runtimeId) {
      if (!entries.has(runtimeId)) {
        throw new Error(`Runtime not found: ${runtimeId}`);
      }
      const handle = handles.get(runtimeId);
      if (handle) {
        await handle.stop();
        handles.delete(runtimeId);
      }
      entries.delete(runtimeId);
      return true;
    },
    async stopSession(input) {
      if (input.runtimeKind === "opencode") {
        await stopOpenCodeSession(input);
        return;
      }
      throw new Error(
        `Runtime kind ${input.runtimeKind} does not support session stop in the TypeScript host.`,
      );
    },
    async probeSessionStatus(input) {
      if (input.runtimeKind === "opencode") {
        return probeOpenCodeSessionStatus(input);
      }
      return { supported: false, hasLiveSession: false };
    },
    async probeMcpStatus(input) {
      if (input.runtimeKind === "opencode") {
        return probeOpenCodeMcpStatus(input);
      }
      if (input.runtimeKind === "codex") {
        return probeCodexMcpStatus(input);
      }
      return {
        supported: false,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: null,
        failureKind: null,
      };
    },
  };
};
