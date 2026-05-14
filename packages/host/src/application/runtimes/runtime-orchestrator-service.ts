import {
  type AgentSessionRecord,
  type RuntimeRoute,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
import {
  ACTIVE_MCP_PROBE_ATTEMPTS,
  ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
  buildHealthStatus,
  buildIdleStartupStatus,
  buildReadyStartupStatus,
  describeRuntimeRoute,
  findWorkspaceRuntime,
  loadTargetSession,
  normalizePathForComparison,
  type RuntimeOrchestratorLogger,
  type RuntimeOrchestratorService,
  resolveRepoPath,
  resolveRuntimeDescriptor,
  uniqueRuntimeRoutes,
  validateSessionStopTarget,
} from "./runtime-orchestrator-model";

export type {
  RuntimeListInput,
  RuntimeOrchestratorLogger,
  RuntimeOrchestratorService,
  RuntimeRepoInput,
  RuntimeStopInput,
} from "./runtime-orchestrator-model";

export const createRuntimeOrchestratorService = ({
  gitPort,
  runtimeDefinitionsService,
  runtimeRegistry,
  taskReader,
  activeMcpProbeRetryDelayMs = ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
  logger,
}: {
  gitPort: GitPort;
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: RuntimeRegistryPort;
  taskReader: TaskReader;
  activeMcpProbeRetryDelayMs?: number;
  logger?: RuntimeOrchestratorLogger;
}): RuntimeOrchestratorService => {
  const resolveSessionStopRoute = async (
    request: Parameters<RuntimeOrchestratorService["agentSessionStop"]>[0],
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

  const runtimeList: RuntimeOrchestratorService["runtimeList"] = async (input) => {
    const { runtimeKind, repoPath } = input;
    resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
    const canonicalRepoPath = repoPath ? await resolveRepoPath(gitPort, repoPath) : undefined;
    const runtimes = await runtimeRegistry.listRuntimes();
    return runtimes
      .filter((runtime) => runtime.kind === runtimeKind)
      .filter((runtime) => !canonicalRepoPath || runtime.repoPath === canonicalRepoPath)
      .map((runtime) => runtimeInstanceSummarySchema.parse(runtime));
  };

  const runtimeStartupStatus: RuntimeOrchestratorService["runtimeStartupStatus"] = async (
    input,
  ) => {
    const { runtimeKind, repoPath } = input;
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

  const runtimeEnsure: RuntimeOrchestratorService["runtimeEnsure"] = async (input) => {
    const { runtimeKind, repoPath } = input;
    const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
    const canonicalRepoPath = await resolveRepoPath(gitPort, repoPath);
    logger?.info(`Ensuring ${runtimeKind} workspace runtime for repository ${canonicalRepoPath}`);
    try {
      const runtime = await runtimeRegistry.ensureWorkspaceRuntime({
        runtimeKind,
        repoPath: canonicalRepoPath,
        workingDirectory: canonicalRepoPath,
        descriptor,
      });
      const parsed = runtimeInstanceSummarySchema.parse(runtime);
      logger?.info(
        `${parsed.kind} workspace runtime ${parsed.runtimeId} is ready at ${describeRuntimeRoute(
          parsed.runtimeRoute,
        )}`,
      );
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(
        `Failed to ensure ${runtimeKind} workspace runtime for repository ${canonicalRepoPath}: ${message}`,
      );
      throw error;
    }
  };

  return {
    async agentSessionStop(input) {
      const request = input;
      resolveRuntimeDescriptor(runtimeDefinitionsService, request.runtimeKind);
      const repoPath = await resolveRepoPath(gitPort, request.repoPath);
      const session = await loadTargetSession(
        taskReader,
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
      const { runtimeId } = input;
      return { ok: await runtimeRegistry.stopRuntime(runtimeId) };
    },
    runtimeStartupStatus,
    async repoRuntimeHealth(input) {
      const { runtimeKind, repoPath } = input;
      const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      logger?.info(`Checking ${runtimeKind} repo runtime health for repository ${repoPath}`);
      const runtime = await runtimeEnsure(input);
      const health = await buildHealthStatus(
        descriptor,
        buildReadyStartupStatus(runtime),
        runtimeRegistry,
        {
          mcpProbeAttempts: ACTIVE_MCP_PROBE_ATTEMPTS,
          mcpProbeRetryDelayMs: activeMcpProbeRetryDelayMs,
        },
      );
      logger?.info(
        `${runtimeKind} repo runtime health is ${health.status} for repository ${runtime.repoPath}`,
      );
      return health;
    },
    async repoRuntimeHealthStatus(input) {
      const { runtimeKind } = input;
      const descriptor = resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      return buildHealthStatus(descriptor, await runtimeStartupStatus(input), runtimeRegistry);
    },
  };
};
