import { setTimeout as delay } from "node:timers/promises";
import {
  type AgentSessionRecord,
  agentSessionStopTargetSchema,
  type RepoRuntimeHealthCheck,
  type RepoRuntimeStartupStatus,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeRoute,
  repoRuntimeHealthCheckSchema,
  repoRuntimeStartupStatusSchema,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import type { GitPort } from "../ports/git-port";
import type {
  RuntimeMcpStatusProbeInput,
  RuntimeMcpStatusProbeResult,
  RuntimeRegistryPort,
} from "../ports/runtime-registry-port";
import type { TaskStorePort } from "../ports/task-store-port";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";

export type RuntimeOrchestratorService = {
  agentSessionStop(input: unknown): Promise<{ ok: boolean }>;
  runtimeEnsure(input: unknown): Promise<RuntimeInstanceSummary>;
  runtimeList(input: unknown): Promise<RuntimeInstanceSummary[]>;
  runtimeStop(input: unknown): Promise<{ ok: boolean }>;
  runtimeStartupStatus(input: unknown): Promise<RepoRuntimeStartupStatus>;
  repoRuntimeHealth(input: unknown): Promise<RepoRuntimeHealthCheck>;
  repoRuntimeHealthStatus(input: unknown): Promise<RepoRuntimeHealthCheck>;
};

const nowIso = (): string => new Date().toISOString();
const ACTIVE_MCP_PROBE_ATTEMPTS = 20;
const ACTIVE_MCP_PROBE_RETRY_DELAY_MS = 250;

type BuildHealthStatusOptions = {
  mcpProbeAttempts?: number;
  mcpProbeRetryDelayMs?: number;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when provided.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveRuntimeDescriptor = (
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

const resolveRepoPath = async (gitPort: GitPort, repoPath: string): Promise<string> => {
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

const parseRuntimeListInput = (
  input: unknown,
): {
  runtimeKind: string;
  repoPath?: string;
} => {
  const record = requireRecord(input, "runtime_list input");
  const runtimeKind = requireString(record.runtimeKind, "runtimeKind");
  const repoPath = optionalString(record.repoPath, "repoPath");
  return repoPath ? { runtimeKind, repoPath } : { runtimeKind };
};

const parseRuntimeRepoInput = (
  input: unknown,
  label: string,
): {
  runtimeKind: string;
  repoPath: string;
} => {
  const record = requireRecord(input, `${label} input`);
  return {
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
    repoPath: requireString(record.repoPath, "repoPath"),
  };
};

const parseRuntimeStopInput = (input: unknown): { runtimeId: string } => {
  const record = requireRecord(input, "runtime_stop input");
  return { runtimeId: requireString(record.runtimeId, "runtimeId") };
};

const parseAgentSessionStopInput = (input: unknown) => {
  const record = requireRecord(input, "agent_session_stop input");
  const parsed = agentSessionStopTargetSchema.safeParse(record.request);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`agent_session_stop input.request is invalid: ${parsed.error.message}`);
};

const normalizePathForComparison = (path: string): string => {
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

const runtimeRouteKey = (runtimeRoute: RuntimeRoute): string => JSON.stringify(runtimeRoute);

const uniqueRuntimeRoutes = (runtimeRoutes: RuntimeRoute[]): RuntimeRoute[] => {
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

const loadTargetSession = async (
  taskStore: TaskStorePort,
  repoPath: string,
  taskId: string,
  externalSessionId: string,
): Promise<AgentSessionRecord> => {
  const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
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

const validateSessionStopTarget = (
  request: ReturnType<typeof parseAgentSessionStopInput>,
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

const findWorkspaceRuntime = (
  runtimes: RuntimeInstanceSummary[],
  runtimeKind: string,
  repoPath: string,
): RuntimeInstanceSummary | undefined =>
  runtimes.find(
    (runtime) =>
      runtime.kind === runtimeKind && runtime.repoPath === repoPath && runtime.role === "workspace",
  );

const buildIdleStartupStatus = (
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

const buildReadyStartupStatus = (runtime: RuntimeInstanceSummary): RepoRuntimeStartupStatus =>
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

const buildHealthStatus = (
  descriptor: RuntimeDescriptor,
  startupStatus: RepoRuntimeStartupStatus,
  runtimeRegistry: RuntimeRegistryPort,
  options: BuildHealthStatusOptions = {},
): Promise<RepoRuntimeHealthCheck> => {
  const runtimeReady = startupStatus.stage === "runtime_ready";
  const checkedAt = nowIso();
  const runtimeState = runtimeReady ? "ready" : "idle";
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

const probeMcpStatusWithRetry = async (
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

export const createRuntimeOrchestratorService = ({
  gitPort,
  runtimeDefinitionsService,
  runtimeRegistry,
  taskStore,
  activeMcpProbeRetryDelayMs = ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
}: {
  gitPort: GitPort;
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: RuntimeRegistryPort;
  taskStore: TaskStorePort;
  activeMcpProbeRetryDelayMs?: number;
}): RuntimeOrchestratorService => {
  const resolveSessionStopRoute = async (
    request: ReturnType<typeof parseAgentSessionStopInput>,
    repoPath: string,
    session: AgentSessionRecord,
  ): Promise<RuntimeRoute> => {
    const runtimes = (await runtimeRegistry.listRuntimes()).filter(
      (runtime) => runtime.kind === request.runtimeKind && runtime.repoPath === repoPath,
    );
    const normalizedWorkingDirectory = normalizePathForComparison(request.workingDirectory);
    const exactRoutes = uniqueRuntimeRoutes(
      runtimes
        .filter(
          (runtime) =>
            normalizePathForComparison(runtime.workingDirectory) === normalizedWorkingDirectory,
        )
        .map((runtime) => runtime.runtimeRoute),
    );
    if (exactRoutes.length === 1) {
      return exactRoutes[0] as RuntimeRoute;
    }
    if (exactRoutes.length > 1) {
      throw new Error(
        `Multiple live runtime routes matched externalSessionId ${request.externalSessionId}`,
      );
    }

    const repoRoutes = uniqueRuntimeRoutes(runtimes.map((runtime) => runtime.runtimeRoute));
    if (repoRoutes.length === 1) {
      return repoRoutes[0] as RuntimeRoute;
    }
    if (repoRoutes.length === 0) {
      throw new Error(
        `No live runtime route found for externalSessionId ${request.externalSessionId}`,
      );
    }
    if (!runtimeRegistry.probeSessionStatus) {
      throw new Error(
        `Multiple live runtime routes matched externalSessionId ${request.externalSessionId}; runtime session status probing is not configured.`,
      );
    }

    const matchingRoutes: RuntimeRoute[] = [];
    for (const runtimeRoute of repoRoutes) {
      const probe = await runtimeRegistry.probeSessionStatus({
        runtimeKind: request.runtimeKind,
        runtimeRoute,
        externalSessionId: session.externalSessionId,
        workingDirectory: request.workingDirectory,
      });
      if (probe.supported && probe.hasLiveSession) {
        matchingRoutes.push(runtimeRoute);
      }
    }

    if (matchingRoutes.length === 1) {
      return matchingRoutes[0] as RuntimeRoute;
    }
    if (matchingRoutes.length === 0) {
      throw new Error(
        `No live runtime route found for externalSessionId ${request.externalSessionId}`,
      );
    }
    throw new Error(
      `Multiple live runtime routes matched externalSessionId ${request.externalSessionId}`,
    );
  };

  const runtimeList = async (input: unknown): Promise<RuntimeInstanceSummary[]> => {
    const { runtimeKind, repoPath } = parseRuntimeListInput(input);
    resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
    const canonicalRepoPath = repoPath ? await resolveRepoPath(gitPort, repoPath) : undefined;
    const runtimes = await runtimeRegistry.listRuntimes();
    return runtimes
      .filter((runtime) => runtime.kind === runtimeKind)
      .filter((runtime) => !canonicalRepoPath || runtime.repoPath === canonicalRepoPath)
      .map((runtime) => runtimeInstanceSummarySchema.parse(runtime));
  };

  const runtimeStartupStatus = async (input: unknown): Promise<RepoRuntimeStartupStatus> => {
    const { runtimeKind, repoPath } = parseRuntimeRepoInput(input, "runtime_startup_status");
    resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
    const canonicalRepoPath = await resolveRepoPath(gitPort, repoPath);
    const runtime = findWorkspaceRuntime(
      await runtimeRegistry.listRuntimes(),
      runtimeKind,
      canonicalRepoPath,
    );
    return runtime
      ? buildReadyStartupStatus(runtime)
      : buildIdleStartupStatus(runtimeKind, canonicalRepoPath);
  };

  const runtimeEnsure = async (input: unknown): Promise<RuntimeInstanceSummary> => {
    const { runtimeKind, repoPath } = parseRuntimeRepoInput(input, "runtime_ensure");
    const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
    const canonicalRepoPath = await resolveRepoPath(gitPort, repoPath);
    const runtime = await runtimeRegistry.ensureWorkspaceRuntime({
      runtimeKind,
      repoPath: canonicalRepoPath,
      workingDirectory: canonicalRepoPath,
      descriptor,
    });
    return runtimeInstanceSummarySchema.parse(runtime);
  };

  return {
    async agentSessionStop(input) {
      const request = parseAgentSessionStopInput(input);
      resolveRuntimeDescriptor(runtimeDefinitionsService, request.runtimeKind);
      const repoPath = await resolveRepoPath(gitPort, request.repoPath);
      const session = await loadTargetSession(
        taskStore,
        repoPath,
        request.taskId,
        request.externalSessionId,
      );
      validateSessionStopTarget(request, session);
      const runtimeRoute = await resolveSessionStopRoute(request, repoPath, session);
      await runtimeRegistry.stopSession({
        runtimeKind: request.runtimeKind,
        runtimeRoute,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      return { ok: true };
    },
    runtimeEnsure,
    runtimeList,
    async runtimeStop(input) {
      const { runtimeId } = parseRuntimeStopInput(input);
      return { ok: await runtimeRegistry.stopRuntime(runtimeId) };
    },
    runtimeStartupStatus,
    async repoRuntimeHealth(input) {
      const { runtimeKind } = parseRuntimeRepoInput(input, "repo_runtime_health");
      const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const runtime = await runtimeEnsure(input);
      return buildHealthStatus(descriptor, buildReadyStartupStatus(runtime), runtimeRegistry, {
        mcpProbeAttempts: ACTIVE_MCP_PROBE_ATTEMPTS,
        mcpProbeRetryDelayMs: activeMcpProbeRetryDelayMs,
      });
    },
    async repoRuntimeHealthStatus(input) {
      const { runtimeKind } = parseRuntimeRepoInput(input, "repo_runtime_health_status");
      const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      return buildHealthStatus(descriptor, await runtimeStartupStatus(input), runtimeRegistry);
    },
  };
};
