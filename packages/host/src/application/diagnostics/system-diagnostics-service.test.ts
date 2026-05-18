import type {
  GlobalConfig,
  RepoStoreHealth,
  RuntimeDescriptor,
  RuntimeHealth,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
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
  versionForCommand?: (command: string) => string | null;
} = {}): SystemCommandPort => {
  const missing = new Set(missingCommands);
  const port: SystemCommandPort = {
    resolveCommandPath: (command) => Effect.succeed(missing.has(command) ? null : command),
    requiredCommandError: (command) =>
      Effect.succeed(
        missing.has(command)
          ? `Required command \`${command}\` not found. Install ${command} and ensure it is available on PATH.`
          : null,
      ),
    versionCommand: (command) =>
      Effect.succeed(
        missing.has(command) ? null : (versionForCommand?.(command) ?? `${command} version 1.0.0`),
      ),
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
const healthyRepoStoreHealth: RepoStoreHealth = {
  category: "healthy",
  status: "ready",
  isReady: true,
  detail: "Beads attachment is healthy.",
  attachment: {
    path: "/repo/.beads",
    databaseName: null,
  },
  sharedServer: {
    host: null,
    port: null,
    ownershipState: "unavailable",
  },
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
  input: Parameters<typeof createSystemDiagnosticsService>[0],
) => createSystemDiagnosticsService(input);
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
          opencode: { enabled: true },
          codex: { enabled: false },
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
  test("runtimeCheck reports actionable missing git and gh diagnostics", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(["opencode"]),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({ missingCommands: ["git", "gh"] }),
      repoStoreDiagnostics: createTaskStore(),
    });

    const check = await Effect.runPromise(service.runtimeCheck(true));

    expect(check.gitOk).toBe(false);
    expect(check.ghOk).toBe(false);
    expect(check.ghAuthOk).toBe(false);
    expect(check.ghAuthError).toBe(
      "Required command `gh` not found. Install gh and ensure it is available on PATH.",
    );
    expect(check.errors).toEqual([
      "Required command `git` not found. Install git and ensure it is available on PATH.",
      "Required command `gh` not found. Install gh and ensure it is available on PATH.",
    ]);
  });
  test("beadsCheck returns structured blocking health when bd is missing", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({ missingCommands: ["bd"] }),
      repoStoreDiagnostics: createTaskStore(),
    });
    const check = await Effect.runPromise(service.beadsCheck("/repo"));
    expect(check).toEqual({
      beadsOk: false,
      beadsPath: null,
      beadsError: "Required command `bd` not found. Install bd and ensure it is available on PATH.",
      repoStoreHealth: {
        category: "attachment_verification_failed",
        status: "blocking",
        isReady: false,
        detail: "Required command `bd` not found. Install bd and ensure it is available on PATH.",
        attachment: { path: null, databaseName: null },
        sharedServer: { host: null, port: null, ownershipState: "unavailable" },
      },
    });
  });
  test("beadsCheck returns structured blocking health when dolt is missing", async () => {
    const service = createSystemDiagnosticsServiceForTest({
      runtimeDefinitionsService: createRuntimeDefinitions(),
      runtimeHealth: createRuntimeHealthPort(),
      settingsConfig: createSettingsConfig(null),
      systemCommands: createSystemCommandPort({ missingCommands: ["dolt"] }),
      repoStoreDiagnostics: createTaskStore(),
    });
    const check = await Effect.runPromise(service.beadsCheck("/repo"));
    expect(check).toEqual({
      beadsOk: false,
      beadsPath: null,
      beadsError:
        "Required command `dolt` not found. Install dolt and ensure it is available on PATH.",
      repoStoreHealth: {
        category: "attachment_verification_failed",
        status: "blocking",
        isReady: false,
        detail:
          "Required command `dolt` not found. Install dolt and ensure it is available on PATH.",
        attachment: { path: null, databaseName: null },
        sharedServer: { host: null, port: null, ownershipState: "unavailable" },
      },
    });
  });
  test("beadsCheck delegates active repo store readiness through the task store", async () => {
    const restoreNeededHealth: RepoStoreHealth = {
      category: "missing_shared_database",
      status: "restore_needed",
      isReady: false,
      detail: "Shared Dolt database odt_repo is missing and restore is required",
      attachment: {
        path: "/repo/.beads",
        databaseName: "odt_repo",
      },
      sharedServer: {
        host: "127.0.0.1",
        port: 36000,
        ownershipState: "owned_by_current_process",
      },
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
      repoStoreDiagnostics: createTaskStore(restoreNeededHealth, calls),
    });
    await expect(Effect.runPromise(service.beadsCheck("/repo"))).resolves.toEqual({
      beadsOk: false,
      beadsPath: "/repo/.beads",
      beadsError: "Shared Dolt database odt_repo is missing and restore is required",
      repoStoreHealth: restoreNeededHealth,
    });
    expect(calls).toEqual([{ repoPath: "/repo", prepare: true }]);
  });
});
