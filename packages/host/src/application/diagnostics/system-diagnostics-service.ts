import {
  DEFAULT_AGENT_RUNTIMES,
  type RepoStoreHealth,
  type RuntimeCheck,
  type RuntimeHealth,
  type SystemCheck,
  type TaskStoreCheck,
  type ToolExecutableProvenance,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { createDefaultGlobalConfig, type LoadedGlobalConfig } from "../../config/global-config";
import {
  errorMessage,
  type HostOperationError,
  type HostValidationError,
} from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";
import type { RepoStoreDiagnostics, TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ToolDiscoveryError,
  ToolDiscoveryId,
  ToolDiscoveryPort,
} from "../../ports/tool-discovery-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";

type CachedRuntimeCheck = {
  checkedAt: number;
  value: RuntimeCheck;
};
export type SystemDiagnosticsService = {
  runtimeCheck(forceRefresh?: boolean): Effect.Effect<RuntimeCheck, SystemDiagnosticsError>;
  taskStoreCheck(repoPath: string): Effect.Effect<TaskStoreCheck, SystemDiagnosticsError>;
  systemCheck(repoPath: string): Effect.Effect<SystemCheck, SystemDiagnosticsError>;
};
export type SystemDiagnosticsError =
  | HostOperationError
  | HostValidationError
  | SettingsConfigError
  | TaskStoreError
  | ToolDiscoveryError;
const RUNTIME_CHECK_CACHE_TTL_MS = 5 * 60 * 1000;
const GH_NON_INTERACTIVE_ENV = { GH_PROMPT_DISABLED: "1" };
const loadGlobalConfig = (settingsConfig: SettingsConfigPort) =>
  Effect.gen(function* () {
    return (yield* settingsConfig.readConfig()) ?? createDefaultGlobalConfig();
  });
const parseGithubAuthLogin = (output: string): string | null => {
  const accountMarker = "account ";
  const markerIndex = output.indexOf(accountMarker);
  if (markerIndex < 0) {
    return null;
  }
  const remainder = output.slice(markerIndex + accountMarker.length).trimStart();
  const login = remainder.split(/[\s(']/)[0]?.trim() ?? "";
  return login.length > 0 ? login : null;
};
const probeGithubAuthStatus = (systemCommands: SystemCommandPort, ghCommand: string) =>
  Effect.gen(function* () {
    const result: SystemCommandRunResult = yield* systemCommands.runCommandAllowFailure(
      ghCommand,
      ["auth", "status", "--hostname", "github.com"],
      {
        env: GH_NON_INTERACTIVE_ENV,
      },
    );
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const combined =
      stderr.length === 0 ? stdout : stdout.length === 0 ? stderr : `${stdout}\n${stderr}`;
    if (result.ok) {
      return {
        ghAuthOk: true,
        ghAuthLogin: parseGithubAuthLogin(combined),
        ghAuthError: null,
      };
    }
    return {
      ghAuthOk: false,
      ghAuthLogin: null,
      ghAuthError:
        combined.length > 0
          ? combined
          : "GitHub authentication is not configured. Run `gh auth login`.",
    };
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "Failed to query GitHub authentication status.",
      }),
    ),
  );
const buildTaskStoreCheck = (repoStoreHealth: RepoStoreHealth): TaskStoreCheck => {
  const taskStoreError = !repoStoreHealth.isReady ? repoStoreHealth.detail : null;
  return {
    repoStoreHealth,
    taskStoreOk: repoStoreHealth.isReady,
    taskStorePath: repoStoreHealth.databasePath,
    taskStoreError,
  };
};
const enabledForRuntime = (config: LoadedGlobalConfig, kind: string): boolean =>
  config.agentRuntimes[kind]?.enabled ?? DEFAULT_AGENT_RUNTIMES[kind]?.enabled ?? false;
type ToolAvailability = ToolExecutableProvenance;
type ToolVersionAvailability = {
  error: string | null;
  version: string | null;
};
const resolveToolAvailability = (
  toolDiscovery: ToolDiscoveryPort,
  toolId: ToolDiscoveryId,
): Effect.Effect<ToolAvailability, never> =>
  Effect.either(toolDiscovery.resolveTool(toolId)).pipe(
    Effect.map((result) =>
      result._tag === "Right"
        ? {
            displayLabel: result.right.displayLabel,
            error: null,
            path: result.right.path,
            sourceCategory: result.right.sourceCategory,
          }
        : {
            displayLabel: "Unavailable",
            error: errorMessage(result.left),
            path: null,
            sourceCategory: "unavailable",
          },
    ),
  );
const versionForResolvedTool = (
  systemCommands: SystemCommandPort,
  toolName: string,
  toolPath: string | null,
  args: string[],
) =>
  toolPath === null
    ? Effect.succeed({ error: null, version: null } satisfies ToolVersionAvailability)
    : Effect.either(systemCommands.versionCommand(toolPath, args)).pipe(
        Effect.map((result) => {
          if (result._tag === "Left") {
            return {
              error: `Failed reading ${toolName} --version from ${toolPath}: ${errorMessage(result.left)}`,
              version: null,
            } satisfies ToolVersionAvailability;
          }
          if (result.right === null) {
            return {
              error: `Failed reading ${toolName} --version from ${toolPath}.`,
              version: null,
            } satisfies ToolVersionAvailability;
          }
          return { error: null, version: result.right } satisfies ToolVersionAvailability;
        }),
      );
export const createSystemDiagnosticsService = ({
  runtimeDefinitionsService,
  runtimeHealth,
  settingsConfig,
  systemCommands,
  toolDiscovery,
  repoStoreDiagnostics,
}: {
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  repoStoreDiagnostics: RepoStoreDiagnostics;
}): SystemDiagnosticsService => {
  let cachedRuntimeCheck: CachedRuntimeCheck | null = null;
  const probeRuntimeCheck = () =>
    Effect.gen(function* () {
      const gitTool = yield* resolveToolAvailability(toolDiscovery, "git");
      const ghTool = yield* resolveToolAvailability(toolDiscovery, "githubCli");
      const gitVersion = yield* versionForResolvedTool(systemCommands, "git", gitTool.path, [
        "--version",
      ]);
      const ghVersion = yield* versionForResolvedTool(systemCommands, "gh", ghTool.path, [
        "--version",
      ]);
      const gitError = gitTool.error ?? gitVersion.error;
      const ghError = ghTool.error ?? ghVersion.error;
      const gitOk = gitError === null;
      const ghOk = ghError === null;
      const githubAuth =
        ghOk && ghTool.path !== null
          ? yield* probeGithubAuthStatus(systemCommands, ghTool.path)
          : { ghAuthOk: false, ghAuthLogin: null, ghAuthError: ghError };
      const config = yield* loadGlobalConfig(settingsConfig);
      const runtimes: RuntimeHealth[] = [];
      for (const definition of runtimeDefinitionsService.listRuntimeDefinitions()) {
        const health = yield* runtimeHealth.getRuntimeHealth(definition.kind);
        runtimes.push({
          ...health,
          enabled: enabledForRuntime(config, definition.kind),
        });
      }
      const errors = [gitError].filter((error): error is string => error !== null);
      for (const runtime of runtimes) {
        if (runtime.enabled && runtime.error) {
          errors.push(runtime.error);
        }
      }
      return {
        gitOk,
        gitVersion: gitVersion.version,
        ghOk,
        ghVersion: ghVersion.version,
        ...githubAuth,
        runtimes,
        errors,
      };
    });
  const runtimeCheck = (forceRefresh?: boolean) =>
    Effect.gen(function* () {
      const force = forceRefresh ?? false;
      if (!force && cachedRuntimeCheck) {
        const now = yield* Clock.currentTimeMillis;
        if (now - cachedRuntimeCheck.checkedAt <= RUNTIME_CHECK_CACHE_TTL_MS) {
          return cachedRuntimeCheck.value;
        }
        cachedRuntimeCheck = null;
      }
      const check = yield* probeRuntimeCheck();
      const checkedAt = yield* Clock.currentTimeMillis;
      cachedRuntimeCheck = {
        checkedAt,
        value: check,
      };
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
        gitOk: runtime.gitOk,
        gitVersion: runtime.gitVersion,
        ghOk: runtime.ghOk,
        ghVersion: runtime.ghVersion,
        ghAuthOk: runtime.ghAuthOk,
        ghAuthLogin: runtime.ghAuthLogin,
        ghAuthError: runtime.ghAuthError,
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
