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
import { Clock, Effect, Schedule } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type {
  RuntimeMcpStatusProbeInput,
  RuntimeMcpStatusProbeResult,
  RuntimeRegistryError,
  RuntimeRegistryPort,
} from "../../ports/runtime-registry-port";
import type { TaskReader, TaskStoreError } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
export type RuntimeOrchestratorError =
  | GitPortError
  | HostOperationError
  | HostValidationError
  | RuntimeRegistryError
  | TaskStoreError;

export type RuntimeOrchestratorService = {
  agentSessionStop(input: AgentSessionStopTarget): Effect.Effect<
    {
      ok: boolean;
    },
    RuntimeOrchestratorError
  >;
  runtimeEnsure(
    input: RuntimeRepoInput,
  ): Effect.Effect<RuntimeInstanceSummary, RuntimeOrchestratorError>;
  runtimeList(
    input: RuntimeListInput,
  ): Effect.Effect<RuntimeInstanceSummary[], RuntimeOrchestratorError>;
  runtimeStop(input: RuntimeStopInput): Effect.Effect<
    {
      ok: boolean;
    },
    RuntimeOrchestratorError
  >;
  runtimeStartupStatus(
    input: RuntimeRepoInput,
  ): Effect.Effect<RepoRuntimeStartupStatus, RuntimeOrchestratorError>;
  repoRuntimeHealth(
    input: RuntimeRepoInput,
  ): Effect.Effect<RepoRuntimeHealthCheck, RuntimeOrchestratorError>;
  repoRuntimeHealthStatus(
    input: RuntimeRepoInput,
  ): Effect.Effect<RepoRuntimeHealthCheck, RuntimeOrchestratorError>;
};
export type RuntimeOrchestratorLogger = {
  info(message: string): void;
  error(message: string): void;
};
export const isoFromMillis = (millis: number): string => new Date(millis).toISOString();
export const ACTIVE_MCP_PROBE_ATTEMPTS = 20;
export const ACTIVE_MCP_PROBE_RETRY_DELAY_MS = 250;
export const activeMcpReadinessProbeSchedule = (attempts: number, retryDelayMs: number) =>
  Schedule.addDelay(Schedule.recurs(Math.max(1, attempts) - 1), () => `${retryDelayMs} millis`);
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
) =>
  Effect.gen(function* () {
    const runtime = runtimeDefinitionsService
      .listRuntimeDefinitions()
      .find((definition) => definition.kind === runtimeKind);
    if (!runtime) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Unsupported runtime kind: ${runtimeKind}`,
          details: { runtimeKind },
        }),
      );
    }
    return runtime;
  });
export const resolveRepoPath = (gitPort: GitPort, repoPath: string) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            field: "repoPath",
            message: `repoPath does not exist or is not accessible: ${repoPath}`,
            cause: error,
            details: { repoPath },
          }),
      ),
    );
    if (!(yield* gitPort.isGitRepository(canonicalRepoPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "repoPath",
          message: `Not a git repository: ${canonicalRepoPath}`,
          details: { repoPath: canonicalRepoPath },
        }),
      );
    }
    return canonicalRepoPath;
  });
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
export const loadTargetSession = (
  taskReader: TaskReader,
  repoPath: string,
  taskId: string,
  externalSessionId: string,
) =>
  Effect.gen(function* () {
    const metadata = yield* taskReader.getTaskMetadata({ repoPath, taskId });
    const session = metadata.agentSessions.find(
      (entry) => entry.externalSessionId === externalSessionId,
    );
    if (!session) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "externalSessionId",
          message: `Agent session with externalSessionId ${externalSessionId} was not found for task ${taskId}`,
          details: { repoPath, taskId, externalSessionId },
        }),
      );
    }
    return session;
  });
export const validateSessionStopTarget = (
  request: AgentSessionStopTarget,
  session: AgentSessionRecord,
) =>
  Effect.gen(function* () {
    if (session.runtimeKind.trim() !== request.runtimeKind) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Agent session with externalSessionId ${request.externalSessionId} runtime kind mismatch: expected ${request.runtimeKind}, found ${session.runtimeKind.trim()}`,
          details: {
            externalSessionId: request.externalSessionId,
            expectedRuntimeKind: request.runtimeKind,
            actualRuntimeKind: session.runtimeKind.trim(),
          },
        }),
      );
    }
    const sessionWorkingDirectory = normalizePathForComparison(session.workingDirectory);
    const requestWorkingDirectory = normalizePathForComparison(request.workingDirectory);
    if (sessionWorkingDirectory !== requestWorkingDirectory) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "workingDirectory",
          message: `Agent session with externalSessionId ${request.externalSessionId} working directory mismatch: expected ${request.workingDirectory}, found ${session.workingDirectory}`,
          details: {
            externalSessionId: request.externalSessionId,
            expectedWorkingDirectory: request.workingDirectory,
            actualWorkingDirectory: session.workingDirectory,
          },
        }),
      );
    }
  });
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
  updatedAt: string,
): RepoRuntimeStartupStatus => {
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
export const buildWaitingStartupStatus = (
  runtimeKind: string,
  repoPath: string,
  startedAt: string,
): RepoRuntimeStartupStatus =>
  repoRuntimeStartupStatusSchema.parse({
    runtimeKind,
    repoPath,
    stage: "waiting_for_runtime",
    runtime: null,
    startedAt,
    updatedAt: startedAt,
    elapsedMs: null,
    attempts: 0,
    failureKind: null,
    failureReason: null,
    detail: null,
  });
export const buildFailedStartupStatus = (
  runtimeKind: string,
  repoPath: string,
  startedAt: string,
  failedAt: string,
  failureReason: string,
  detail: string,
): RepoRuntimeStartupStatus => {
  const startedAtMs = Date.parse(startedAt);
  const failedAtMs = Date.parse(failedAt);
  const elapsedMs =
    Number.isNaN(startedAtMs) || Number.isNaN(failedAtMs)
      ? null
      : Math.max(failedAtMs - startedAtMs, 0);
  return repoRuntimeStartupStatusSchema.parse({
    runtimeKind,
    repoPath,
    stage: "startup_failed",
    runtime: null,
    startedAt,
    updatedAt: failedAt,
    elapsedMs,
    attempts: null,
    failureKind: "error",
    failureReason,
    detail,
  });
};
export const buildHealthStatus = (
  descriptor: RuntimeDescriptor,
  startupStatus: RepoRuntimeStartupStatus,
  runtimeRegistry: RuntimeRegistryPort,
  options: BuildHealthStatusOptions = {},
): Effect.Effect<RepoRuntimeHealthCheck, RuntimeRegistryError> =>
  Effect.gen(function* () {
    const runtimeReady = startupStatus.stage === "runtime_ready";
    const startupFailed = startupStatus.stage === "startup_failed";
    const startupInProgress =
      startupStatus.stage === "startup_requested" || startupStatus.stage === "waiting_for_runtime";
    const checkedAt = isoFromMillis(yield* Clock.currentTimeMillis);
    const runtimeState = runtimeReady
      ? "ready"
      : startupFailed
        ? "error"
        : startupInProgress
          ? "checking"
          : "not_started";
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
      detail: runtimeReady
        ? null
        : (startupStatus.detail ??
          (startupFailed
            ? (startupStatus.failureReason ?? "Runtime startup failed.")
            : startupInProgress
              ? "Runtime startup is in progress."
              : "Runtime has not been started yet.")),
      failureKind: startupStatus.failureKind,
      failureReason: startupStatus.failureReason,
    };
    if (!supportsMcp) {
      return repoRuntimeHealthCheckSchema.parse({
        status: runtimeState,
        checkedAt,
        runtime: runtimeHealth,
        mcp: null,
      });
    }
    if (!runtimeReady || !startupStatus.runtime) {
      return repoRuntimeHealthCheckSchema.parse({
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
      });
    }
    if (!runtimeRegistry.probeMcpStatus) {
      return repoRuntimeHealthCheckSchema.parse({
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
      });
    }
    return yield* probeMcpStatusWithRetry(
      runtimeRegistry,
      {
        runtimeKind: descriptor.kind,
        runtimeRoute: startupStatus.runtime.runtimeRoute,
        workingDirectory: startupStatus.runtime.workingDirectory,
        serverName: "openducktor",
      },
      options.mcpProbeAttempts ?? 1,
      options.mcpProbeRetryDelayMs ?? ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
    ).pipe(
      Effect.map((probe) =>
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
      ),
      Effect.catchAll((error) => {
        const detail = errorMessage(error);
        return Effect.succeed(
          repoRuntimeHealthCheckSchema.parse({
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
          }),
        );
      }),
    );
  });
export const probeMcpStatusWithRetry = (
  runtimeRegistry: RuntimeRegistryPort,
  input: RuntimeMcpStatusProbeInput,
  attempts: number,
  retryDelayMs: number,
) => {
  const totalAttempts = Math.max(1, attempts);
  let lastProbe: RuntimeMcpStatusProbeResult | null = null;
  const probeOnce = Effect.gen(function* () {
    const probe = yield* runtimeRegistry.probeMcpStatus(input);
    if (probe.connected || !probe.supported) {
      return probe;
    }
    lastProbe = probe;
    return yield* Effect.fail(
      new HostOperationError({
        operation: "runtime_orchestrator.probe_mcp_status",
        message: probe.detail ?? "Runtime MCP status is not ready.",
        details: {
          runtimeKind: input.runtimeKind,
          serverName: input.serverName,
        },
      }),
    );
  });
  return probeOnce.pipe(
    Effect.retry(activeMcpReadinessProbeSchedule(totalAttempts, retryDelayMs)),
    Effect.catchAll((error) => (lastProbe ? Effect.succeed(lastProbe) : Effect.fail(error))),
  );
};
