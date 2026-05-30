import {
  type BeadsCheck,
  DEFAULT_AGENT_RUNTIMES,
  type RepoStoreHealth,
  type RuntimeCheck,
  type RuntimeHealth,
  type SystemCheck,
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
  beadsCheck(repoPath: string): Effect.Effect<BeadsCheck, SystemDiagnosticsError>;
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
const repoStoreHealthForMissingCommand = (detail: string): RepoStoreHealth => ({
  category: "attachment_verification_failed",
  status: "blocking",
  isReady: false,
  detail,
  attachment: {
    path: null,
    databaseName: null,
  },
  sharedServer: {
    host: null,
    port: null,
    ownershipState: "unavailable",
  },
});
const buildBeadsCheck = (repoStoreHealth: RepoStoreHealth): BeadsCheck => {
  const beadsError =
    !repoStoreHealth.isReady && repoStoreHealth.status !== "initializing"
      ? repoStoreHealth.detail
      : null;
  return {
    repoStoreHealth,
    beadsOk: repoStoreHealth.isReady,
    beadsPath: repoStoreHealth.attachment.path,
    beadsError,
  };
};
const enabledForRuntime = (config: LoadedGlobalConfig, kind: string): boolean =>
  config.agentRuntimes[kind]?.enabled ?? DEFAULT_AGENT_RUNTIMES[kind]?.enabled ?? false;
type ToolAvailability = {
  error: string | null;
  path: string | null;
};
const resolveToolAvailability = (
  toolDiscovery: ToolDiscoveryPort,
  toolId: ToolDiscoveryId,
): Effect.Effect<ToolAvailability, never> =>
  Effect.either(toolDiscovery.resolveToolPath(toolId)).pipe(
    Effect.map((result) =>
      result._tag === "Right"
        ? { error: null, path: result.right }
        : { error: errorMessage(result.left), path: null },
    ),
  );
const versionForResolvedTool = (
  systemCommands: SystemCommandPort,
  toolPath: string | null,
  args: string[],
) =>
  toolPath === null
    ? Effect.succeed(null)
    : systemCommands
        .versionCommand(toolPath, args)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
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
      const gitError = gitTool.error;
      const ghError = ghTool.error;
      const gitOk = gitError === null;
      const ghOk = ghError === null;
      const githubAuth =
        ghTool.path !== null
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
      const errors = [gitError, ghError].filter((error): error is string => error !== null);
      for (const runtime of runtimes) {
        if (runtime.enabled && runtime.error) {
          errors.push(runtime.error);
        }
      }
      return {
        gitOk,
        gitVersion: yield* versionForResolvedTool(systemCommands, gitTool.path, ["--version"]),
        ghOk,
        ghVersion: yield* versionForResolvedTool(systemCommands, ghTool.path, ["--version"]),
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
  const beadsCheck = (repoPath: string) =>
    Effect.gen(function* () {
      const validatedRepoPath = repoPath;
      const bdTool = yield* resolveToolAvailability(toolDiscovery, "beads");
      if (bdTool.error !== null) {
        return buildBeadsCheck(repoStoreHealthForMissingCommand(bdTool.error));
      }
      const doltTool = yield* resolveToolAvailability(toolDiscovery, "dolt");
      if (doltTool.error !== null) {
        return buildBeadsCheck(repoStoreHealthForMissingCommand(doltTool.error));
      }
      const repoStoreHealth = yield* repoStoreDiagnostics.diagnoseRepoStore({
        repoPath: validatedRepoPath,
        prepare: true,
      });
      return buildBeadsCheck(repoStoreHealth);
    });
  const systemCheck = (repoPath: string) =>
    Effect.gen(function* () {
      const runtime = yield* runtimeCheck(false);
      const beads = yield* beadsCheck(repoPath);
      const errors = [...runtime.errors];
      if (beads.beadsError) {
        errors.push(`beads: ${beads.beadsError}`);
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
        repoStoreHealth: beads.repoStoreHealth,
        beadsOk: beads.beadsOk,
        beadsPath: beads.beadsPath,
        beadsError: beads.beadsError,
        errors,
      };
    });
  return {
    runtimeCheck,
    beadsCheck,
    systemCheck,
  };
};
