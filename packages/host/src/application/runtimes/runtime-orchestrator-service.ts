import {
  type RepoRuntimeStartupStatus,
  type RuntimeInstanceSummary,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { errorMessage } from "../../effect/host-errors";
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
  findWorkspaceRuntime,
  isoFromMillis,
  loadTargetSession,
  type RuntimeOrchestratorLogger,
  type RuntimeOrchestratorService,
  resolveRepoPath,
  resolveRuntimeDescriptor,
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
  const runtimeStartupStatuses = new Map<string, RepoRuntimeStartupStatus>();
  const startupStatusKey = (runtimeKind: string, repoPath: string): string =>
    `${runtimeKind}::${normalizePathForComparison(repoPath)}`;
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
  const runtimeStartupStatus: RuntimeOrchestratorService["runtimeStartupStatus"] = (input) =>
    Effect.gen(function* () {
      const { runtimeKind, repoPath } = input;
      yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
      const canonicalRepoPath = yield* resolveRepoPath(gitPort, repoPath);
      const runtime = findWorkspaceRuntime(
        yield* runtimeRegistry.listRuntimesByRepo({
          repoPath: canonicalRepoPath,
          runtimeKind,
        }),
        runtimeKind,
        canonicalRepoPath,
      );
      if (runtime) {
        const readyStatus = buildReadyStartupStatus(runtime);
        runtimeStartupStatuses.set(startupStatusKey(runtimeKind, canonicalRepoPath), readyStatus);
        return readyStatus;
      }
      return (
        runtimeStartupStatuses.get(startupStatusKey(runtimeKind, canonicalRepoPath)) ??
        buildIdleStartupStatus(
          runtimeKind,
          canonicalRepoPath,
          isoFromMillis(yield* Clock.currentTimeMillis),
        )
      );
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
      logger?.info(`Ensuring ${runtimeKind} workspace runtime for repository ${canonicalRepoPath}`);
      const ensureResult = yield* Effect.either(
        runtimeRegistry.ensureWorkspaceRuntime({
          runtimeKind,
          repoPath: canonicalRepoPath,
          workingDirectory: canonicalRepoPath,
          descriptor,
        }),
      );
      if (ensureResult._tag === "Right") {
        const runtime = ensureResult.right;
        const parsed = runtimeInstanceSummarySchema.parse(runtime);
        logger?.info(
          `${parsed.kind} workspace runtime ${parsed.runtimeId} is ready at ${describeRuntimeRoute(parsed.runtimeRoute)}`,
        );
        runtimeStartupStatuses.set(statusKey, buildReadyStartupStatus(parsed));
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
      logger?.error(
        `Failed to ensure ${runtimeKind} workspace runtime for repository ${canonicalRepoPath}: ${message}`,
      );
      return yield* Effect.fail(ensureResult.left);
    });
  const service: RuntimeOrchestratorService = {
    agentSessionStop(input) {
      return Effect.gen(function* () {
        const request = input;
        yield* resolveRuntimeDescriptor(runtimeDefinitionsService, request.runtimeKind);
        const repoPath = yield* resolveRepoPath(gitPort, request.repoPath);
        const session = yield* loadTargetSession(
          taskReader,
          repoPath,
          request.taskId,
          request.externalSessionId,
        );
        yield* validateSessionStopTarget(request, session);
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
    runtimeList,
    runtimeStop(input) {
      return Effect.gen(function* () {
        const { runtimeId } = input;
        const runtime = yield* runtimeRegistry.findRuntimeById(runtimeId);
        const ok = yield* runtimeRegistry.stopRuntime(runtimeId);
        if (runtime) {
          runtimeStartupStatuses.delete(startupStatusKey(runtime.kind, runtime.repoPath));
        }
        return { ok };
      });
    },
    runtimeStartupStatus,
    repoRuntimeHealth(input) {
      return Effect.gen(function* () {
        const { runtimeKind, repoPath } = input;
        const descriptor = yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
        logger?.info(`Checking ${runtimeKind} repo runtime health for repository ${repoPath}`);
        const runtimeResult = yield* Effect.either(runtimeEnsure(input));
        if (runtimeResult._tag === "Left") {
          return yield* buildHealthStatus(
            descriptor,
            yield* runtimeStartupStatus(input),
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
        logger?.info(
          `${runtimeKind} repo runtime health is ${health.status} for repository ${runtime.repoPath}`,
        );
        return health;
      });
    },
    repoRuntimeHealthStatus(input) {
      return Effect.gen(function* () {
        const { runtimeKind } = input;
        const descriptor = yield* resolveRuntimeDescriptor(runtimeDefinitionsService, runtimeKind);
        return yield* buildHealthStatus(
          descriptor,
          yield* runtimeStartupStatus(input),
          runtimeRegistry,
        );
      });
    },
  };
  return service;
};
