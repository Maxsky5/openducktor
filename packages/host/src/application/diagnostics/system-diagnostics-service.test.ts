import {
  DEFAULT_AGENT_RUNTIMES,
  type GlobalConfig,
  type RepoStoreHealth,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  type RuntimeHealth,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createToolDiscoveryAdapter } from "../../adapters/system/tool-discovery";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import { ProcessEnvironmentError } from "../../infrastructure/process/process-environment";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createUserEnvironment } from "../../infrastructure/process/user-environment";
import type {
  UserEnvironmentPort,
  UserEnvironmentResolution,
} from "../../ports/user-environment-port";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { createSystemDiagnosticsService } from "./system-diagnostics-service";

const runtimeDefinition = (kind: RuntimeDescriptor["kind"]): RuntimeDescriptor =>
  RUNTIME_DESCRIPTORS_BY_KIND[kind];
const runtimeHealth = (
  kind: RuntimeHealth["kind"],
  error: string | null = null,
): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: error === null,
  executablePath: `/bin/${kind}`,
  version: error === null ? `${kind} 1.0.0` : null,
  error,
});
const createSettingsConfig = (config: GlobalConfig | null): SettingsConfigPort =>
  ({
    readConfig: () =>
      Effect.tryPromise({
        try: async () => {
          return config;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
    writeConfig: (_nextConfig: GlobalConfig) =>
      Effect.tryPromise({
        try: async () => {
          return undefined;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
    defaultWorktreeBasePath: (workspaceId) => `/tmp/worktrees/${workspaceId}`,
    defaultRepoWorktreeBasePath: (repoPath) =>
      `/tmp/worktrees/${repoPath.split("/").at(-1) ?? "repo"}`,
    resolveConfiguredPath: (rawPath) => rawPath,
    canonicalizePath: (rawPath) =>
      Effect.tryPromise({
        try: async () => {
          return rawPath;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
    pathExists: () => Effect.succeed(true),
    join: (...paths) => paths.join("/"),
  }) satisfies SettingsConfigPort;
const createRuntimeDefinitions = (
  kinds: RuntimeDescriptor["kind"][] = ["opencode", "codex"],
): RuntimeDefinitionsService => ({
  listRuntimeDefinitions: () => kinds.map(runtimeDefinition),
});
const createRuntimeHealthPort = (
  healthByKind: Partial<Record<RuntimeHealth["kind"], RuntimeHealth>> = {},
): RuntimeHealthPort => ({
  readVersion: () => Effect.succeed(null),
  getRuntimeHealth: (kind) =>
    ({
      getRuntimeHealth: () =>
        Effect.tryPromise({
          try: async () => {
            return healthByKind[kind] ?? runtimeHealth(kind);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        }),
    }).getRuntimeHealth(),
});
const createSystemCommandPort = ({
  missingCommands = [],
  versionCalls = [],
  versionForCommand,
}: {
  missingCommands?: string[];
  versionCalls?: Array<{
    command: string;
    args: string[];
    options: Parameters<SystemCommandPort["versionCommand"]>[2];
  }>;
  versionForCommand?: (command: string) => string | null | undefined;
} = {}): SystemCommandPort => {
  const missing = new Set(missingCommands);
  const port: SystemCommandPort = {
    resolveCommandPath: (command) => Effect.succeed(missing.has(command) ? null : command),
    versionCommand: (command, args, options) => {
      versionCalls.push({ command, args, options });
      const version = versionForCommand?.(command);
      return Effect.succeed(
        missing.has(command) ? null : version === undefined ? `${command} version 1.0.0` : version,
      );
    },
    runCommandAllowFailure: () => Effect.succeed({ ok: true, stdout: "", stderr: "" }),
  };
  return port;
};
const createToolDiscoveryPort = ({
  missingCommands = [],
  versionForCommand,
}: {
  missingCommands?: string[];
  versionForCommand?: (command: string) => string | null;
} = {}): ToolDiscoveryPort =>
  createToolDiscoveryAdapter({
    systemCommands: createSystemCommandPort({
      missingCommands,
      versionForCommand: (command) => versionForCommand?.(command) ?? `${command} version 1.0.0`,
    }),
  });
const healthyRepoStoreHealth: RepoStoreHealth = {
  category: "healthy",
  status: "ready",
  isReady: true,
  detail: "SQLite task store is ready.",
  databasePath: "/config/task-stores/workspace-1/database.sqlite",
};
const createTaskStore = (
  health: RepoStoreHealth = healthyRepoStoreHealth,
  calls: Array<{
    repoPath: string;
    prepare?: boolean;
  }> = [],
): TaskStorePort =>
  createTaskStoreTestDouble({
    diagnoseRepoStore: (input) =>
      Effect.tryPromise({
        try: async () => {
          calls.push(input);
          return health;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
  });
const resolutionOf = (message: string | null): UserEnvironmentResolution => ({
  environment: {},
  error:
    message === null
      ? null
      : new ProcessEnvironmentError({ message, reason: "timed_out", shell: "/bin/zsh" }),
});
/** A user environment whose PATH stays as given. */
const userEnvironmentWith = (error: string | null = null) =>
  createUserEnvironment(resolutionOf(error), Effect.succeed(resolutionOf(error)));
/** A user environment whose refresh applies the next queued PATH error. */
const createRefreshableUserEnvironment = (
  initialError: string | null,
  refreshErrors: (string | null)[],
) => {
  let refreshCount = 0;
  const userEnvironment = createUserEnvironment(
    resolutionOf(initialError),
    Effect.sync(() => {
      refreshCount += 1;
      return resolutionOf(refreshErrors.shift() ?? null);
    }),
  );
  return { userEnvironment, refreshCount: () => refreshCount };
};
const createEnabledRuntimeSettings = () => {
  const config = createDefaultGlobalConfig();
  config.agentRuntimes.opencode.enabled = true;
  return createSettingsConfig(config);
};
const createSystemDiagnosticsServiceForTest = (
  input: Omit<
    Parameters<typeof createSystemDiagnosticsService>[0],
    "toolDiscovery" | "userEnvironment"
  > & {
    toolDiscovery?: ToolDiscoveryPort;
    userEnvironment?: UserEnvironmentPort;
  },
) =>
  createSystemDiagnosticsService({
    ...input,
    toolDiscovery: input.toolDiscovery ?? createToolDiscoveryPort(),
    userEnvironment: input.userEnvironment ?? userEnvironmentWith(),
  });
describe("createSystemDiagnosticsService", () => {
  test("runtimeCheck reports Git, runtime health, and config enablement", async () => {
    const runtimeHealthCalls: RuntimeHealth["kind"][] = [];
    const versionCommandCalls: Array<{
      command: string;
      args: string[];
      options: Parameters<SystemCommandPort["versionCommand"]>[2];
    }> = [];
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(),
      runtimeHealth: {
        readVersion: () => Effect.succeed(null),
        getRuntimeHealth: (kind) => {
          runtimeHealthCalls.push(kind);
          return Effect.succeed(runtimeHealth(kind));
        },
      },
      settingsConfig: createSettingsConfig({
        ...createDefaultGlobalConfig(),
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          opencode: {
            ...DEFAULT_AGENT_RUNTIMES.opencode,
            enabled: true,
            executablePath: "/bin/opencode",
          },
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
        },
      }),
      systemCommands: createSystemCommandPort({
        versionCalls: versionCommandCalls,
      }),
      repoStoreDiagnostics: createTaskStore(),
    });
    const check = await Effect.runPromise(service.runtimeCheck(true));
    expect(check.pathOk).toBe(true);
    expect(check.gitOk).toBe(true);
    expect(check.runtimes).toEqual([
      expect.objectContaining({ kind: "opencode", enabled: true, ok: true }),
      expect.objectContaining({
        kind: "codex",
        enabled: false,
        ok: false,
        error: null,
      }),
    ]);
    expect(runtimeHealthCalls).toEqual(["opencode"]);
    expect(check.errors).toEqual([]);
    expect(versionCommandCalls).toContainEqual(
      expect.objectContaining({ command: "git", args: ["--version"] }),
    );
  });
  test("runtimeCheck caches fresh results unless force refresh is requested", async () => {
    let version = "1.0.0";
    const systemCommands = createSystemCommandPort({
      versionForCommand: (command) => `${command} version ${version}`,
    });
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands,
      toolDiscovery: createToolDiscoveryPort({
        versionForCommand: (command) => `${command} version ${version}`,
      }),
      repoStoreDiagnostics: createTaskStore(),
    });
    const first = await Effect.runPromise(service.runtimeCheck(true));
    version = "2.0.0";
    const cached = await Effect.runPromise(service.runtimeCheck(false));
    const refreshed = await Effect.runPromise(service.runtimeCheck(true));
    expect(first.gitVersion).toBe("git version 1.0.0");
    expect(cached.gitVersion).toBe("git version 1.0.0");
    expect(refreshed.gitVersion).toBe("git version 2.0.0");
  });
  test("runtimeCheck probes independent runtimes concurrently", async () => {
    const startedKinds: RuntimeHealth["kind"][] = [];
    let releaseProbes!: () => void;
    const probesStarted = new Promise<void>((resolve) => {
      releaseProbes = resolve;
    });
    const runtimeHealthPort: RuntimeHealthPort = {
      readVersion: () => Effect.succeed(null),
      getRuntimeHealth: (kind) =>
        Effect.tryPromise({
          try: async () => {
            startedKinds.push(kind);
            if (startedKinds.length === 2) releaseProbes();
            await probesStarted;
            return runtimeHealth(kind);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.runtimeHealth",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    };
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode", "codex"]),
      runtimeHealth: runtimeHealthPort,
      settingsConfig: createSettingsConfig({
        ...createDefaultGlobalConfig(),
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          opencode: {
            defaults: { rules: [] },
            roleOverrides: {},
            enabled: true,
            executablePath: "/bin/opencode",
          },
          codex: {
            ...DEFAULT_AGENT_RUNTIMES.codex,
            enabled: true,
            executablePath: "/bin/codex",
          },
        },
      }),
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(
      service.runtimeCheck(true).pipe(
        Effect.timeoutFail({
          duration: "250 millis",
          onTimeout: () =>
            new HostOperationError({
              operation: "test.runtimeHealth",
              message: "Runtime probes did not start concurrently.",
            }),
        }),
      ),
    );

    expect(startedKinds).toEqual(["opencode", "codex"]);
    expect(check.runtimes.map(({ kind }) => kind)).toEqual(["opencode", "codex"]);
  });
  test("runtimeCheck reports unhealthy CLI tools when version probes fail", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({
        versionForCommand: (command) => (command === "git" ? null : undefined),
      }),
      toolDiscovery: createToolDiscoveryPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(check.gitOk).toBe(false);
    expect(check.gitVersion).toBeNull();
    expect(check.errors).toEqual(["Failed reading git --version from git."]);
  });
  test("runtimeCheck includes the startup PATH diagnostic", async () => {
    const processEnvironmentError = new ProcessEnvironmentError({
      message:
        "Failed to resolve PATH from interactive login shell /bin/zsh: the probe timed out after 5000 ms. Check shell startup files for commands that wait for input.",
      reason: "timed_out",
      shell: "/bin/zsh",
    });
    const service = createSystemDiagnosticsServiceForTest({
      userEnvironment: userEnvironmentWith(processEnvironmentError.message),
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort(),
      toolDiscovery: createToolDiscoveryPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(check.pathOk).toBe(false);
    expect(check.errors).toContain(processEnvironmentError.message);
  });
  test("runtimeCheck resolves PATH again only when the check is forced", async () => {
    const pathError = "Failed to resolve PATH from the interactive login shell.";
    const { userEnvironment, refreshCount } = createRefreshableUserEnvironment(pathError, [null]);
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
      userEnvironment,
    });

    const cachedCheck = await Effect.runPromise(service.runtimeCheck(false));
    const forcedCheck = await Effect.runPromise(service.runtimeCheck(true));

    expect(cachedCheck.pathOk).toBe(false);
    expect(cachedCheck.errors).toContain(pathError);
    expect(refreshCount()).toBe(1);
    expect(forcedCheck.pathOk).toBe(true);
    expect(forcedCheck.errors).not.toContain(pathError);
  });
  test("runtimeCheck does not reuse a cached result after a refresh changes PATH and fails", async () => {
    const pathError = "Failed to resolve PATH: login shell timed out.";
    const { userEnvironment } = createRefreshableUserEnvironment(null, [pathError]);
    let failHealth = false;
    const runtimeHealthPort: RuntimeHealthPort = {
      readVersion: () => Effect.succeed(null),
      getRuntimeHealth: (kind) =>
        failHealth
          ? Effect.fail(
              new HostOperationError({
                operation: "test.runtimeHealth",
                message: "Runtime health probe failed.",
              }),
            )
          : Effect.succeed(runtimeHealth(kind)),
    };
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: runtimeHealthPort,
      settingsConfig: createEnabledRuntimeSettings(),
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
      userEnvironment,
    });

    const healthyCheck = await Effect.runPromise(service.runtimeCheck(false));
    failHealth = true;
    const forcedResult = await Effect.runPromise(service.runtimeCheck(true).pipe(Effect.either));
    failHealth = false;
    const nextCheck = await Effect.runPromise(service.runtimeCheck(false));

    expect(healthyCheck.pathOk).toBe(true);
    expect(forcedResult._tag).toBe("Left");
    expect(nextCheck.pathOk).toBe(false);
    expect(nextCheck.errors).toContain(pathError);
  });
  test("runtimeCheck keeps the result of a newer PATH resolution over an older overlapping check", async () => {
    const pathError = "Failed to resolve PATH: login shell timed out.";
    const { userEnvironment } = createRefreshableUserEnvironment(pathError, [null]);
    const program = Effect.gen(function* () {
      const olderCheckStarted = yield* Deferred.make<void>();
      const releaseOlderCheck = yield* Deferred.make<void>();
      let healthCalls = 0;
      const runtimeHealthPort: RuntimeHealthPort = {
        readVersion: () => Effect.succeed(null),
        getRuntimeHealth: (kind) =>
          Effect.gen(function* () {
            healthCalls += 1;
            if (healthCalls === 1) {
              yield* Deferred.succeed(olderCheckStarted, undefined);
              yield* Deferred.await(releaseOlderCheck);
            }
            return runtimeHealth(kind);
          }),
      };
      const service = createSystemDiagnosticsServiceForTest({
        runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
        runtimeHealth: runtimeHealthPort,
        settingsConfig: createEnabledRuntimeSettings(),
        systemCommands: createSystemCommandPort(),
        repoStoreDiagnostics: createTaskStore(),
        userEnvironment,
      });

      const olderCheck = yield* Effect.fork(service.runtimeCheck(false));
      yield* Deferred.await(olderCheckStarted);
      const forcedCheck = yield* service.runtimeCheck(true);
      yield* Deferred.succeed(releaseOlderCheck, undefined);
      const olderResult = yield* Fiber.join(olderCheck);
      const nextCheck = yield* service.runtimeCheck(false);
      return { forcedCheck, olderResult, nextCheck, healthCalls };
    });

    const { forcedCheck, olderResult, nextCheck, healthCalls } = await Effect.runPromise(program);

    expect(olderResult.pathOk).toBe(false);
    expect(forcedCheck.pathOk).toBe(true);
    expect(nextCheck.pathOk).toBe(true);
    expect(nextCheck.errors).toEqual([]);
    // The next ordinary check reads the cached result of the forced check.
    expect(healthCalls).toBe(2);
  });
  test("runtimeCheck reads config without initialization when PATH is unavailable", async () => {
    const pathError = "Failed to resolve PATH from the interactive login shell.";
    const readOptions: Array<Parameters<SettingsConfigPort["readConfig"]>[0]> = [];
    const config = createDefaultGlobalConfig();
    config.agentRuntimes.codex.enabled = true;
    const settingsConfig = {
      ...createSettingsConfig(null),
      readConfig: (options?: Parameters<SettingsConfigPort["readConfig"]>[0]) => {
        readOptions.push(options);
        return Effect.succeed(config);
      },
    } satisfies SettingsConfigPort;
    const service = createSystemDiagnosticsServiceForTest({
      userEnvironment: userEnvironmentWith(pathError),
      runtimeDefinitionsService: createRuntimeDefinitions(["codex"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig,
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(readOptions).toEqual([{ initialize: false }]);
    expect(check.pathOk).toBe(false);
    expect(check.runtimes).toContainEqual(
      expect.objectContaining({ kind: "codex", enabled: true }),
    );
    expect(check.errors).toContain(pathError);
  });
  test("runtimeCheck does not hide unrelated config failures", async () => {
    const settingsError = new HostOperationError({
      operation: "settingsConfig.readConfig",
      message: "Failed to read settings.",
    });
    const settingsConfig = {
      ...createSettingsConfig(null),
      readConfig: () => Effect.fail(settingsError),
    } satisfies SettingsConfigPort;
    const service = createSystemDiagnosticsServiceForTest({
      userEnvironment: userEnvironmentWith(
        "Failed to resolve PATH from the interactive login shell.",
      ),
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig,
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const result = await Effect.runPromise(service.runtimeCheck(true).pipe(Effect.either));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBe(settingsError);
    }
  });
  test("taskStoreCheck delegates active repo store readiness through the task store", async () => {
    const blockingHealth: RepoStoreHealth = {
      category: "database_unavailable",
      status: "blocking",
      isReady: false,
      detail: "SQLite task store database is unavailable",
      databasePath: "/config/task-stores/workspace-1/database.sqlite",
    };
    const calls: Array<{
      repoPath: string;
      prepare?: boolean;
    }> = [];
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(blockingHealth, calls),
    });
    await expect(Effect.runPromise(service.taskStoreCheck("/repo"))).resolves.toEqual({
      taskStoreOk: false,
      taskStorePath: "/config/task-stores/workspace-1/database.sqlite",
      taskStoreError: "SQLite task store database is unavailable",
      repoStoreHealth: blockingHealth,
    });
    expect(calls).toEqual([{ repoPath: "/repo", prepare: true }]);
  });
});
