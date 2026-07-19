import {
  type RepoRuntimeStartupStatus,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
import {
  ACTIVE_MCP_PROBE_ATTEMPTS,
  ACTIVE_MCP_PROBE_RETRY_DELAY_MS,
  buildFailedStartupStatus,
  buildHealthStatus,
  buildIdleStartupStatus,
  buildReadyStartupStatus,
  buildWaitingStartupStatus,
  describeRuntimeRoute,
  isoFromMillis,
  loadTargetSession,
  type RuntimeOrchestratorLogger,
  type RuntimeOrchestratorService,
  resolveRepoPath,
  resolveRuntimeDescriptor,
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
  const runtimeStartupStatuses = new Map<string, RepoRuntimeStartupStatus>();
  const writeRuntimeLog = (
    level: "error" | "info",
    message: string,
  ): Effect.Effect<void, HostOperationError> =>
    logger
      ? logger[level](message).pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation: `runtime-orchestrator.log-${level}`,
                message: errorMessage(cause),
                cause,
              }),
          ),
        )
      : Effect.void;
  const startupStatusKey = (runtimeKind: string, repoPath: string): string =>
    `${runtimeKind}::${repoPath}`;
  const ensureWorkspaceRuntime = ({
    runtimeKind,
    repoPath,
    descriptor,
  }: {
    runtimeKind: string;
    repoPath: string;
    descriptor: RuntimeDescriptor;
  }) =>
    runtimeRegistry
      .ensureWorkspaceRuntime({
        runtimeKind,
        repoPath,
        workingDirectory: repoPath,
        descriptor,
      })
      .pipe(
        Effect.flatMap((runtime) =>
          Effect.try({
            try: () => runtimeInstanceSummarySchema.parse(runtime),
            catch: (cause) =>
              new HostValidationError({
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
                details: { runtimeKind, repoPath },
              }),
          }),
        ),
      );
  const runtimeList: RuntimeOrchestratorService["runtimeList"] = (input) =>
    Effect.gen(function* () {
      const { runtimeKind, repoPath } = input;
      yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const canonicalRepoPath = repoPath ? yield* resolveRepoPath(gitPort, repoPath) : undefined;
      let runtimes: RuntimeInstanceSummary[];
      if (canonicalRepoPath) {
        runtimes = yield* runtimeRegistry.listRuntimesByRepo({
          repoPath: canonicalRepoPath,
          runtimeKind,
        });
      } else {
        const registeredRuntimes = yield* runtimeRegistry.listRuntimes();
        runtimes = registeredRuntimes.filter((runtime) => runtime.kind === runtimeKind);
      }
      return runtimes.map((runtime) => runtimeInstanceSummarySchema.parse(runtime));
    });
  const loadRuntimeStartupStatus = (input: { repoPath: string; runtimeKind: string }) =>
    Effect.gen(function* () {
      const { runtimeKind, repoPath } = input;
      yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const canonicalRepoPath = yield* resolveRepoPath(gitPort, repoPath);
      const runtime = yield* runtimeRegistry.findWorkspaceRuntime({
        repoPath: canonicalRepoPath,
        runtimeKind,
      });
      const statusKey = startupStatusKey(runtimeKind, canonicalRepoPath);
      if (runtime) {
        const readyStatus = buildReadyStartupStatus(runtimeInstanceSummarySchema.parse(runtime));
        runtimeStartupStatuses.set(statusKey, readyStatus);
        return readyStatus;
      }

      const cachedStatus = runtimeStartupStatuses.get(statusKey);
      if (cachedStatus && cachedStatus.stage !== "runtime_ready") {
        return cachedStatus;
      }

      return buildIdleStartupStatus(
        runtimeKind,
        canonicalRepoPath,
        isoFromMillis(yield* Clock.currentTimeMillis),
      );
    });
  const runtimeRequire: RuntimeOrchestratorService["runtimeRequire"] = (input) =>
    Effect.gen(function* () {
      const { runtimeKind, repoPath } = input;
      yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const canonicalRepoPath = yield* resolveRepoPath(gitPort, repoPath);
      const runtime = yield* runtimeRegistry.findWorkspaceRuntime({
        repoPath: canonicalRepoPath,
        runtimeKind,
      });
      if (!runtime) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `No live repo runtime found for repo '${canonicalRepoPath}', runtime '${runtimeKind}'.`,
            details: { repoPath: canonicalRepoPath, runtimeKind },
          }),
        );
      }
      return runtimeInstanceSummarySchema.parse(runtime);
    });
  const runtimeEnsure: RuntimeOrchestratorService["runtimeEnsure"] = (input) =>
    Effect.gen(function* () {
      const { runtimeKind, repoPath } = input;
      const descriptor = yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const canonicalRepoPath = yield* resolveRepoPath(gitPort, repoPath);
      const statusKey = startupStatusKey(runtimeKind, canonicalRepoPath);
      const startedAt = isoFromMillis(yield* Clock.currentTimeMillis);
      runtimeStartupStatuses.set(
        statusKey,
        buildWaitingStartupStatus(runtimeKind, canonicalRepoPath, startedAt),
      );
      const ensureResult = yield* Effect.either(
        ensureWorkspaceRuntime({
          runtimeKind,
          repoPath: canonicalRepoPath,
          descriptor,
        }),
      );
      if (ensureResult._tag === "Right") {
        const parsed = ensureResult.right;
        runtimeStartupStatuses.set(statusKey, buildReadyStartupStatus(parsed));
        yield* writeRuntimeLog(
          "info",
          `${parsed.kind} workspace runtime ${parsed.runtimeId} is ready at ${describeRuntimeRoute(parsed.runtimeRoute)}`,
        );
        return parsed;
      }
      const message = errorMessage(ensureResult.left);
      const failedAt = isoFromMillis(yield* Clock.currentTimeMillis);
      runtimeStartupStatuses.set(
        statusKey,
        buildFailedStartupStatus(
          runtimeKind,
          canonicalRepoPath,
          startedAt,
          failedAt,
          "error",
          message,
        ),
      );
      const loggingResult = yield* Effect.either(
        writeRuntimeLog(
          "error",
          `Failed to ensure ${runtimeKind} workspace runtime for repository ${canonicalRepoPath}: ${message}`,
        ),
      );
      if (loggingResult._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "runtime-orchestrator.ensure",
            message: `${message}; additionally failed to persist the runtime startup failure: ${loggingResult.left.message}`,
            cause: ensureResult.left,
            details: {
              runtimeFailure: ensureResult.left,
              loggingFailure: loggingResult.left,
            },
          }),
        );
      }
      return yield* Effect.fail(ensureResult.left);
    });
  const service: RuntimeOrchestratorService = {
    agentSessionStop(input) {
      return Effect.gen(function* () {
        const request = input;
        yield* resolveRuntimeDescriptor(runtimeDefinitionsService, request.runtimeKind);
        const repoPath = yield* resolveRepoPath(gitPort, request.repoPath);
        const session = yield* loadTargetSession(taskReader, repoPath, request.taskId, request);
        yield* runtimeRegistry.stopSession({
          runtimeKind: request.runtimeKind,
          repoPath,
          externalSessionId: session.externalSessionId,
          workingDirectory: session.workingDirectory,
        });
        return { ok: true };
      });
    },
    runtimeEnsure,
    runtimeRequire,
    runtimeList,
    runtimeStop(input) {
      return Effect.gen(function* () {
        const { runtimeId } = input;
        const ok = yield* runtimeRegistry.stopRuntime(runtimeId);
        return { ok };
      });
    },
    repoRuntimeHealth(input) {
      return Effect.gen(function* () {
        const { runtimeKind, repoPath } = input;
        const descriptor = yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
        const canonicalRepoPath = yield* resolveRepoPath(gitPort, repoPath);
        yield* writeRuntimeLog(
          "info",
          `Checking ${runtimeKind} repo runtime health for repository ${canonicalRepoPath}`,
        );
        const runtimeResult = yield* Effect.either(runtimeEnsure(input));
        if (runtimeResult._tag === "Left") {
          if (
            runtimeResult.left instanceof HostOperationError &&
            (runtimeResult.left.operation === "runtime-orchestrator.log-info" ||
              runtimeResult.left.details?.loggingFailure instanceof HostOperationError)
          ) {
            return yield* Effect.fail(runtimeResult.left);
          }
          return yield* buildHealthStatus(
            descriptor,
            yield* loadRuntimeStartupStatus({ runtimeKind, repoPath: canonicalRepoPath }),
            runtimeRegistry,
          );
        }
        const runtime: RuntimeInstanceSummary = runtimeResult.right;
        const health = yield* buildHealthStatus(
          descriptor,
          buildReadyStartupStatus(runtime),
          runtimeRegistry,
          {
            mcpProbeAttempts: ACTIVE_MCP_PROBE_ATTEMPTS,
            mcpProbeRetryDelayMs: activeMcpProbeRetryDelayMs,
          },
        );
        yield* writeRuntimeLog(
          "info",
          `${runtimeKind} repo runtime health is ${health.status} for repository ${runtime.repoPath}`,
        );
        return health;
      });
    },
    repoRuntimeHealthStatus(input) {
      return Effect.gen(function* () {
        const descriptor = yield* resolveRuntimeDescriptor(
          runtimeDefinitionsService,
          input.runtimeKind,
        );
        return yield* buildHealthStatus(
          descriptor,
          yield* loadRuntimeStartupStatus(input),
          runtimeRegistry,
        );
      });
    },
  };
  return service;
};
