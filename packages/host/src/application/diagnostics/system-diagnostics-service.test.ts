import {
  DEFAULT_AGENT_RUNTIMES,
  type GlobalConfig,
  type RepoStoreHealth,
  type RuntimeDescriptor,
  type RuntimeHealth,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createToolDiscoveryAdapter } from "../../adapters/system/tool-discovery";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { createSystemDiagnosticsService } from "./system-diagnostics-service";

const runtimeDefinition = (kind: RuntimeDescriptor["kind"]): RuntimeDescriptor =>
  ({
    kind,
  }) as RuntimeDescriptor;
const runtimeHealth = (
  kind: RuntimeHealth["kind"],
  error: string | null = null,
): RuntimeHealth => ({
  kind,
  enabled: true,
  ok: error === null,
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
  }) as SettingsConfigPort as SettingsConfigPort;
const createRuntimeDefinitions = (
  kinds: RuntimeDescriptor["kind"][] = ["opencode", "codex"],
): RuntimeDefinitionsService => ({
  listRuntimeDefinitions: () => kinds.map(runtimeDefinition),
});
const createRuntimeHealthPort = (
  healthByKind: Partial<Record<RuntimeHealth["kind"], RuntimeHealth>> = {},
): RuntimeHealthPort => ({
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
  ghAuthResult = { ok: true, stdout: "Logged in to github.com account octocat\n", stderr: "" },
  versionForCommand,
}: {
  missingCommands?: string[];
  ghAuthResult?: SystemCommandRunResult;
  versionForCommand?: (command: string) => string | null | undefined;
} = {}): SystemCommandPort => {
  const missing = new Set(missingCommands);
  const port: SystemCommandPort = {
    resolveCommandPath: (command) => Effect.succeed(missing.has(command) ? null : command),
    versionCommand: (command, _args, _options) => {
      const version = versionForCommand?.(command);
      return Effect.succeed(
        missing.has(command) ? null : version === undefined ? `${command} version 1.0.0` : version,
      );
    },
    runCommandAllowFailure: (command) =>
      Effect.tryPromise({
        try: async () => {
          if (command === "gh") {
            return ghAuthResult;
          }
          return { ok: true, stdout: "", stderr: "" };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
  };
  return port as SystemCommandPort;
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
  ({
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
  }) as Pick<TaskStorePort, "diagnoseRepoStore"> as unknown as TaskStorePort;
const createSystemDiagnosticsServiceForTest = (
  input: Omit<Parameters<typeof createSystemDiagnosticsService>[0], "toolDiscovery"> & {
    toolDiscovery?: ToolDiscoveryPort;
  },
) =>
  createSystemDiagnosticsService({
    ...input,
    toolDiscovery: input.toolDiscovery ?? createToolDiscoveryPort(),
  });
describe("createSystemDiagnosticsService", () => {
  test("runtimeCheck reports CLI, GitHub auth, runtime health, and config enablement", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(),
      runtimeHealth: createRuntimeHealthPort({
        codex: runtimeHealth("codex", "codex not found"),
      }),
      settingsConfig: createSettingsConfig({
        ...createDefaultGlobalConfig(),
        agentRuntimes: {
          ...DEFAULT_AGENT_RUNTIMES,
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
        },
      }),
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
    });
    const check = await Effect.runPromise(service.runtimeCheck(true));
    expect(check.gitOk).toBe(true);
    expect(check.ghOk).toBe(true);
    expect(check.ghAuthOk).toBe(true);
    expect(check.ghAuthLogin).toBe("octocat");
    expect(check.runtimes).toEqual([
      expect.objectContaining({ kind: "opencode", enabled: true, ok: true }),
      expect.objectContaining({
        kind: "codex",
        enabled: false,
        ok: false,
        error: "codex not found",
      }),
    ]);
    expect(check.errors).toEqual([]);
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
  test("runtimeCheck reports missing gh without making it a blocking diagnostic error", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({ missingCommands: ["git", "gh"] }),
      toolDiscovery: createToolDiscoveryPort({ missingCommands: ["git", "gh"] }),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(check.gitOk).toBe(false);
    expect(check.ghOk).toBe(false);
    expect(check.ghAuthOk).toBe(false);
    expect(check.ghAuthError).toBe(
      "gh not found. Checked OPENDUCKTOR_GH_PATH, PATH. Install GitHub CLI and ensure gh is available on PATH, or set OPENDUCKTOR_GH_PATH.",
    );
    expect(check.errors).toEqual([
      "git not found. Checked OPENDUCKTOR_GIT_PATH, PATH. Install git and ensure it is available on PATH, or set OPENDUCKTOR_GIT_PATH.",
    ]);
  });
  test("runtimeCheck reports unhealthy CLI tools when version probes fail", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({
        versionForCommand: (command) => (command === "git" || command === "gh" ? null : undefined),
      }),
      toolDiscovery: createToolDiscoveryPort(),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(check.gitOk).toBe(false);
    expect(check.gitVersion).toBeNull();
    expect(check.ghOk).toBe(false);
    expect(check.ghVersion).toBeNull();
    expect(check.ghAuthOk).toBe(false);
    expect(check.ghAuthError).toBe("Failed reading gh --version from gh.");
    expect(check.errors).toEqual(["Failed reading git --version from git."]);
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
