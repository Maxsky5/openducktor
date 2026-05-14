import {
  type AgentSessionRecord,
  type AgentSessionStopTarget,
  type RepoRuntimeHealthCheck,
  type RepoRuntimeStartupStatus,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeRoute,
  repoRuntimeHealthCheckSchema,
  repoRuntimeStartupStatusSchema,
} from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";
import type {
  RuntimeMcpStatusProbeInput,
  RuntimeMcpStatusProbeResult,
  RuntimeRegistryPort,
} from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";

export type RuntimeOrchestratorService = {
  agentSessionStop(input: AgentSessionStopTarget): Promise<{ ok: boolean }>;
  runtimeEnsure(input: RuntimeRepoInput): Promise<RuntimeInstanceSummary>;
  runtimeList(input: RuntimeListInput): Promise<RuntimeInstanceSummary[]>;
  runtimeStop(input: RuntimeStopInput): Promise<{ ok: boolean }>;
  runtimeStartupStatus(input: RuntimeRepoInput): Promise<RepoRuntimeStartupStatus>;
  repoRuntimeHealth(input: RuntimeRepoInput): Promise<RepoRuntimeHealthCheck>;
  repoRuntimeHealthStatus(input: RuntimeRepoInput): Promise<RepoRuntimeHealthCheck>;
};

export type RuntimeOrchestratorLogger = {
  info(message: string): void;
  error(message: string): void;
};

export const nowIso = (): string => new Date().toISOString();
export const ACTIVE_MCP_PROBE_ATTEMPTS = 20;
export const ACTIVE_MCP_PROBE_RETRY_DELAY_MS = 250;
export const delay = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export type BuildHealthStatusOptions = {
  mcpProbeAttempts?: number;
  mcpProbeRetryDelayMs?: number;
};

export type RuntimeListInput = {
  repoPath?: string;
  runtimeKind: string;
};

export type RuntimeRepoInput = {
  repoPath: string;
  runtimeKind: string;
};

export type RuntimeStopInput = {
  runtimeId: string;
};

export const resolveRuntimeDescriptor = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
): RuntimeDescriptor => {
  const runtime = runtimeDefinitionsService
    .listRuntimeDefinitions()
    .find((definition) => definition.kind === runtimeKind);
  if (!runtime) {
    throw new Error(`Unsupported runtime kind: ${runtimeKind}`);
  }

  return runtime;
};

export const resolveRepoPath = async (gitPort: GitPort, repoPath: string): Promise<string> => {
  const canonicalRepoPath = await gitPort.canonicalizePath(repoPath).catch((error: unknown) => {
    throw new Error(`repoPath does not exist or is not accessible: ${repoPath}`, {
      cause: error,
    });
  });

  if (!(await gitPort.isGitRepository(canonicalRepoPath))) {
    throw new Error(`Not a git repository: ${canonicalRepoPath}`);
  }

  return canonicalRepoPath;
};

export const normalizePathForComparison = (path: string): string => {
  const components: string[] = [];
  for (const component of path.trim().split(/[\\/]+/)) {
    if (!component || component === ".") {
      continue;
    }
    if (component === "..") {
      components.pop();
      continue;
    }
    components.push(component);
  }

  return path.startsWith("/") ? `/${components.join("/")}` : components.join("/");
};

export const runtimeRouteKey = (runtimeRoute: RuntimeRoute): string => JSON.stringify(runtimeRoute);

export const describeRuntimeRoute = (runtimeRoute: RuntimeRoute): string => {
  if (runtimeRoute.type === "local_http") {
    return runtimeRoute.endpoint;
  }
  return `${runtimeRoute.type}:${runtimeRoute.identity}`;
};

export const uniqueRuntimeRoutes = (runtimeRoutes: RuntimeRoute[]): RuntimeRoute[] => {
  const seen = new Set<string>();
  const unique: RuntimeRoute[] = [];
  for (const runtimeRoute of runtimeRoutes) {
    const key = runtimeRouteKey(runtimeRoute);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(runtimeRoute);
  }
  return unique;
};

export const loadTargetSession = async (
  taskReader: TaskReader,
  repoPath: string,
  taskId: string,
  externalSessionId: string,
): Promise<AgentSessionRecord> => {
  const metadata = await taskReader.getTaskMetadata({ repoPath, taskId });
  const session = metadata.agentSessions.find(
    (entry) => entry.externalSessionId === externalSessionId,
  );
  if (!session) {
    throw new Error(
      `Agent session with externalSessionId ${externalSessionId} was not found for task ${taskId}`,
    );
  }
  return session;
};

export const validateSessionStopTarget = (
  request: AgentSessionStopTarget,
  session: AgentSessionRecord,
): void => {
  if (session.runtimeKind.trim() !== request.runtimeKind) {
    throw new Error(
      `Agent session with externalSessionId ${request.externalSessionId} runtime kind mismatch: expected ${request.runtimeKind}, found ${session.runtimeKind.trim()}`,
    );
  }

  if (
    normalizePathForComparison(session.workingDirectory) !==
    normalizePathForComparison(request.workingDirectory)
  ) {
    throw new Error(
      `Agent session with externalSessionId ${request.externalSessionId} working directory mismatch: expected ${request.workingDirectory}, found ${session.workingDirectory}`,
    );
  }
};

export const findWorkspaceRuntime = (
  runtimes: RuntimeInstanceSummary[],
  runtimeKind: string,
  repoPath: string,
): RuntimeInstanceSummary | undefined =>
  runtimes.find(
    (runtime) =>
      runtime.kind === runtimeKind && runtime.repoPath === repoPath && runtime.role === "workspace",
  );

export const buildIdleStartupStatus = (
  runtimeKind: string,
  repoPath: string,
): RepoRuntimeStartupStatus => {
  const updatedAt = nowIso();
  return repoRuntimeStartupStatusSchema.parse({
    runtimeKind,
    repoPath,
    stage: "idle",
    runtime: null,
    startedAt: null,
    updatedAt,
    elapsedMs: null,
    attempts: null,
    failureKind: null,
    failureReason: null,
    detail: null,
  });
};

export const buildReadyStartupStatus = (
  runtime: RuntimeInstanceSummary,
): RepoRuntimeStartupStatus =>
  repoRuntimeStartupStatusSchema.parse({
    runtimeKind: runtime.kind,
    repoPath: runtime.repoPath,
    stage: "runtime_ready",
    runtime,
    startedAt: runtime.startedAt,
    updatedAt: runtime.startedAt,
    elapsedMs: null,
    attempts: null,
    failureKind: null,
    failureReason: null,
    detail: null,
  });

export const buildHealthStatus = (
  descriptor: RuntimeDescriptor,
  startupStatus: RepoRuntimeStartupStatus,
  runtimeRegistry: RuntimeRegistryPort,
  options: BuildHealthStatusOptions = {},
): Promise<RepoRuntimeHealthCheck> => {
  const runtimeReady = startupStatus.stage === "runtime_ready";
  const checkedAt = nowIso();
  const runtimeState = runtimeReady ? "ready" : "not_started";
  const supportsMcp = descriptor.capabilities.optionalSurfaces.supportsMcpStatus;

  const runtimeHealth = {
    status: runtimeState,
    stage: startupStatus.stage,
    observation: runtimeReady ? "observed_existing_runtime" : null,
    instance: startupStatus.runtime,
    startedAt: startupStatus.startedAt,
    updatedAt: startupStatus.updatedAt,
    elapsedMs: startupStatus.elapsedMs,
    attempts: startupStatus.attempts,
    detail: runtimeReady ? null : "Runtime has not been started yet.",
    failureKind: startupStatus.failureKind,
    failureReason: startupStatus.failureReason,
  };

  if (!supportsMcp) {
    return Promise.resolve(
      repoRuntimeHealthCheckSchema.parse({
        status: runtimeState,
        checkedAt,
        runtime: runtimeHealth,
        mcp: null,
      }),
    );
  }

  if (!runtimeReady || !startupStatus.runtime) {
    return Promise.resolve(
      repoRuntimeHealthCheckSchema.parse({
        status: runtimeState,
        checkedAt,
        runtime: runtimeHealth,
        mcp: {
          supported: true,
          status: "waiting_for_runtime",
          serverName: "openducktor",
          serverStatus: null,
          toolIds: [],
          detail: null,
          failureKind: null,
        },
      }),
    );
  }

  if (!runtimeRegistry.probeMcpStatus) {
    return Promise.resolve(
      repoRuntimeHealthCheckSchema.parse({
        status: runtimeState,
        checkedAt,
        runtime: runtimeHealth,
        mcp: {
          supported: true,
          status: "checking",
          serverName: "openducktor",
          serverStatus: null,
          toolIds: [],
          detail: null,
          failureKind: null,
        },
      }),
    );
  }

  return probeMcpStatusWithRetry(
    runtimeRegistry,
    {
      runtimeKind: descriptor.kind,
      runtimeRoute: startupStatus.runtime.runtimeRoute,
      workingDirectory: startupStatus.runtime.workingDirectory,
      serverName: "openducktor",
    },
    options.mcpProbeAttempts ?? 1,
    options.mcpProbeRetryDelayMs ?? ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
  )
    .then((probe) =>
      repoRuntimeHealthCheckSchema.parse({
        status: probe.connected || !probe.supported ? "ready" : "error",
        checkedAt,
        runtime: runtimeHealth,
        mcp: {
          supported: probe.supported,
          status: !probe.supported ? "unsupported" : probe.connected ? "connected" : "error",
          serverName: "openducktor",
          serverStatus: probe.serverStatus,
          toolIds: probe.connected ? probe.toolIds : [],
          detail: probe.detail,
          failureKind: probe.failureKind,
        },
      }),
    )
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      return repoRuntimeHealthCheckSchema.parse({
        status: "error",
        checkedAt,
        runtime: runtimeHealth,
        mcp: {
          supported: true,
          status: "error",
          serverName: "openducktor",
          serverStatus: null,
          toolIds: [],
          detail,
          failureKind: "error",
        },
      });
    });
};

export const probeMcpStatusWithRetry = async (
  runtimeRegistry: RuntimeRegistryPort,
  input: RuntimeMcpStatusProbeInput,
  attempts: number,
  retryDelayMs: number,
): Promise<RuntimeMcpStatusProbeResult> => {
  const totalAttempts = Math.max(1, attempts);
  let lastError: unknown = null;
  let lastProbe: RuntimeMcpStatusProbeResult | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const probe = await runtimeRegistry.probeMcpStatus?.(input);
      if (!probe) {
        throw new Error("Runtime MCP status probing is not configured.");
      }
      if (probe.connected || !probe.supported || attempt === totalAttempts) {
        return probe;
      }
      lastProbe = probe;
    } catch (error) {
      lastError = error;
      if (attempt === totalAttempts) {
        throw error;
      }
    }

    await delay(retryDelayMs);
  }

  if (lastProbe) {
    return lastProbe;
  }
  throw lastError;
};
