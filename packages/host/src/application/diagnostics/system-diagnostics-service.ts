import type {
  RepoStoreHealth,
  RuntimeCheck,
  RuntimeHealth,
  SystemCheck,
  TaskStoreCheck,
  ToolExecutableProvenance,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { createDefaultGlobalConfig, type LoadedGlobalConfig } from "../../config/global-config";
import {
  errorMessage,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { RepoStoreDiagnostics, TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ToolDiscoveryError,
  ToolDiscoveryId,
  ToolDiscoveryPort,
} from "../../ports/tool-discovery-port";
import type { UserEnvironmentPort } from "../../ports/user-environment-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";

type CachedRuntimeCheck = {
  checkedAt: number;
  configSignature: string;
  pathRevision: number;
  value: RuntimeCheck;
};
export type SystemDiagnosticsService = {
  runtimeCheck(forceRefresh?: boolean): Effect.Effect<RuntimeCheck, SystemDiagnosticsError>;
  taskStoreCheck(repoPath: string): Effect.Effect<TaskStoreCheck, SystemDiagnosticsError>;
  systemCheck(repoPath: string): Effect.Effect<SystemCheck, SystemDiagnosticsError>;
};
export type SystemDiagnosticsError =
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError
  | TaskStoreError
  | ToolDiscoveryError;
const RUNTIME_CHECK_CACHE_TTL_MS = 5 * 60 * 1000;
const loadGlobalConfig = (settingsConfig: SettingsConfigPort, pathError: string | null) =>
  settingsConfig
    .readConfig({ initialize: pathError == null })
    .pipe(Effect.map((config) => config ?? createDefaultGlobalConfig()));
const buildTaskStoreCheck = (repoStoreHealth: RepoStoreHealth): TaskStoreCheck => {
  const taskStoreError = !repoStoreHealth.isReady ? repoStoreHealth.detail : null;
  return {
    repoStoreHealth,
    taskStoreOk: repoStoreHealth.isReady,
    taskStorePath: repoStoreHealth.databasePath,
    taskStoreError,
  };
};
const runtimeConfigSignature = (config: LoadedGlobalConfig): string =>
  JSON.stringify(
    Object.entries(config.agentRuntimes)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([kind, runtime]) => [kind, runtime.enabled, runtime.executablePath]),
  );
type ToolAvailability = ToolExecutableProvenance;
type ToolVersionAvailability = {
  error: string | null;
  version: string | null;
};
const resolveToolAvailability = (
  toolDiscovery: ToolDiscoveryPort,
  toolId: ToolDiscoveryId,
): Effect.Effect<ToolAvailability, never> =>
  Effect.result(toolDiscovery.resolveTool(toolId)).pipe(
    Effect.map((result) =>
      result._tag === "Success"
        ? {
            displayLabel: result.success.displayLabel,
            error: null,
            path: result.success.path,
            sourceCategory: result.success.sourceCategory,
          }
        : {
            displayLabel: "Unavailable",
            error: errorMessage(result.failure),
            path: null,
            sourceCategory: "unavailable",
          },
    ),
  );
const versionForResolvedTool = (
  toolName: string,
  toolPath: string | null,
  readVersion: (toolPath: string) => ReturnType<SystemCommandPort["versionCommand"]>,
) =>
  toolPath === null
    ? Effect.succeed({ error: null, version: null } satisfies ToolVersionAvailability)
    : Effect.result(readVersion(toolPath)).pipe(
        Effect.map((result) => {
          if (result._tag === "Failure") {
            return {
              error: `Failed reading ${toolName} --version from ${toolPath}: ${errorMessage(result.failure)}`,
              version: null,
            } satisfies ToolVersionAvailability;
          }
          if (result.success === null) {
            return {
              error: `Failed reading ${toolName} --version from ${toolPath}.`,
              version: null,
            } satisfies ToolVersionAvailability;
          }
          return { error: null, version: result.success } satisfies ToolVersionAvailability;
        }),
      );
export const createSystemDiagnosticsService = ({
  runtimeDefinitionsService,
  runtimeHealth,
  settingsConfig,
  systemCommands,
  toolDiscovery,
  repoStoreDiagnostics,
  userEnvironment,
}: {
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  repoStoreDiagnostics: RepoStoreDiagnostics;
  userEnvironment: UserEnvironmentPort;
}): SystemDiagnosticsService => {
  let cachedRuntimeCheck: CachedRuntimeCheck | null = null;
  const probeRuntimeCheck = (config: LoadedGlobalConfig, pathError: string | null) =>
    Effect.gen(function* () {
      const gitTool = yield* resolveToolAvailability(toolDiscovery, "git");
      const gitVersion = yield* versionForResolvedTool("git", gitTool.path, (path) =>
        systemCommands.versionCommand(path, ["--version"]),
      );
      const gitError = gitTool.error ?? gitVersion.error;
      const gitOk = gitError === null;
      const runtimes: RuntimeHealth[] = yield* Effect.forEach(
        runtimeDefinitionsService.listRuntimeDefinitions(),
        (definition) => {
          const runtimeConfig = config.agentRuntimes[definition.kind];
          if (!runtimeConfig.enabled) {
            return Effect.succeed({
              kind: definition.kind,
              enabled: false,
              ok: false,
              executablePath: runtimeConfig.executablePath || null,
              version: null,
              error: null,
            } satisfies RuntimeHealth);
          }
          return runtimeHealth
            .getRuntimeHealth(definition.kind, runtimeConfig.executablePath)
            .pipe(Effect.map((health) => ({ ...health, enabled: true })));
        },
        { concurrency: "unbounded" },
      );
      const errors = [pathError, gitError].filter((error): error is string => error !== null);
      for (const runtime of runtimes) {
        if (runtime.enabled && runtime.error) {
          errors.push(runtime.error);
        }
      }
      return {
        pathOk: pathError == null,
        gitOk,
        gitVersion: gitVersion.version,
        runtimes,
        errors,
      };
    });
  const runtimeCheck = (forceRefresh?: boolean) =>
    Effect.gen(function* () {
      const force = forceRefresh ?? false;
      if (force) {
        // A forced check reads PATH again, so shell startup fixes apply without a restart.
        yield* userEnvironment.refresh();
      }
      const { revision, error } = userEnvironment.current();
      const pathError = error?.message ?? null;
      const config = yield* loadGlobalConfig(settingsConfig, pathError);
      const configSignature = runtimeConfigSignature(config);
      if (!force && cachedRuntimeCheck) {
        const now = yield* Clock.currentTimeMillis;
        if (
          cachedRuntimeCheck.pathRevision === revision &&
          cachedRuntimeCheck.configSignature === configSignature &&
          now - cachedRuntimeCheck.checkedAt <= RUNTIME_CHECK_CACHE_TTL_MS
        ) {
          return cachedRuntimeCheck.value;
        }
        cachedRuntimeCheck = null;
      }
      const check = yield* probeRuntimeCheck(config, pathError);
      // A check of an older PATH resolution must not replace the result of a newer one.
      if (userEnvironment.current().revision === revision) {
        const checkedAt = yield* Clock.currentTimeMillis;
        cachedRuntimeCheck = {
          checkedAt,
          configSignature,
          pathRevision: revision,
          value: check,
        };
      }
      return check;
    });
  const taskStoreCheck = (repoPath: string) =>
    Effect.gen(function* () {
      const repoStoreHealth = yield* repoStoreDiagnostics.diagnoseRepoStore({
        repoPath,
        prepare: true,
      });
      return buildTaskStoreCheck(repoStoreHealth);
    });
  const systemCheck = (repoPath: string) =>
    Effect.gen(function* () {
      const runtime = yield* runtimeCheck(false);
      const taskStore = yield* taskStoreCheck(repoPath);
      const errors = [...runtime.errors];
      if (taskStore.taskStoreError) {
        errors.push(`task store: ${taskStore.taskStoreError}`);
      }
      return {
        pathOk: runtime.pathOk,
        gitOk: runtime.gitOk,
        gitVersion: runtime.gitVersion,
        runtimes: runtime.runtimes,
        repoStoreHealth: taskStore.repoStoreHealth,
        taskStoreOk: taskStore.taskStoreOk,
        taskStorePath: taskStore.taskStorePath,
        taskStoreError: taskStore.taskStoreError,
        errors,
      };
    });
  return {
    runtimeCheck,
    taskStoreCheck,
    systemCheck,
  };
};
