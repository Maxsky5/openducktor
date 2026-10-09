import { describe, expect, test } from "bun:test";
import type { RepoStoreHealth } from "@openducktor/contracts";
import { Effect } from "effect";
import { createToolDiscoveryAdapter } from "../../adapters/system/tool-discovery";
import { HostOperationError, HostPathAccessError } from "../../effect/host-errors";
import { ProcessEnvironmentError } from "../../infrastructure/process/process-environment";
import { createUserEnvironment } from "../../infrastructure/process/user-environment";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type {
  UserEnvironmentPort,
  UserEnvironmentResolution,
} from "../../ports/user-environment-port";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createSystemDiagnosticsService } from "./system-diagnostics-service";

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
  test("Git reports the discovered executable and bounded version probe", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Parameters<SystemCommandPort["versionCommand"]>[2];
    }> = [];
    const service = createSystemDiagnosticsServiceForTest({
      systemCommands: createSystemCommandPort({ versionCalls: calls }),
      repoStoreDiagnostics: createTaskStore(),
    });
    expect(await Effect.runPromise(service.gitCheck())).toEqual({
      ok: true,
      executablePath: "git",
      version: "git version 1.0.0",
      error: null,
    });
    expect(calls).toEqual([{ command: "git", args: ["--version"], options: { timeoutMs: 2000 } }]);
  });
  test("Git reports discovery failure without running a version probe", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Parameters<SystemCommandPort["versionCommand"]>[2];
    }> = [];
    const service = createSystemDiagnosticsServiceForTest({
      systemCommands: createSystemCommandPort({ versionCalls: calls }),
      toolDiscovery: createToolDiscoveryPort({ missingCommands: ["git"] }),
      repoStoreDiagnostics: createTaskStore(),
    });
    const check = await Effect.runPromise(service.gitCheck());
    expect(check).toMatchObject({ ok: false, executablePath: null, version: null });
    expect(check.error).toContain("git not found");
    expect(calls).toEqual([]);
  });
  test.each(["empty version", "version error"])(
    "Git reports %s at the discovered path",
    async (failure) => {
      const service = createSystemDiagnosticsServiceForTest({
        systemCommands: {
          ...createSystemCommandPort(),
          versionCommand: () =>
            failure === "empty version"
              ? Effect.succeed(null)
              : Effect.fail(
                  new HostPathAccessError({
                    path: "git",
                    operation: "git.version",
                    message: "Permission denied.",
                  }),
                ),
        },
        repoStoreDiagnostics: createTaskStore(),
      });
      const check = await Effect.runPromise(service.gitCheck());
      expect(check).toMatchObject({ ok: false, executablePath: "git", version: null });
      expect(check.error).toContain("Failed reading git --version from git");
      if (failure === "version error") expect(check.error).toContain("Permission denied.");
    },
  );
  test("PATH refresh clears its own failure and Git discovers the new environment", async () => {
    const error = "Failed to resolve PATH: login shell timed out.";
    const userEnvironment = createUserEnvironment(
      { ...resolutionOf(error), environment: { PATH: "/old/bin" } },
      Effect.succeed({ ...resolutionOf(null), environment: { PATH: "/new/bin" } }),
    );
    const systemCommands = {
      ...createSystemCommandPort(),
      resolveCommandPath: () => Effect.succeed(`${userEnvironment.current().environment.PATH}/git`),
    };
    const toolDiscovery = createToolDiscoveryAdapter({ systemCommands });
    const service = createSystemDiagnosticsServiceForTest({
      systemCommands,
      userEnvironment,
      toolDiscovery,
      repoStoreDiagnostics: createTaskStore(),
    });
    // Prime the normal tool cache. Diagnostics must still discover Git again after PATH changes.
    await Effect.runPromise(toolDiscovery.resolveTool("git"));
    expect(await Effect.runPromise(service.pathCheck())).toEqual({ ok: false, error });
    expect(await Effect.runPromise(service.gitCheck())).toMatchObject({
      ok: true,
      executablePath: "/old/bin/git",
    });
    expect(await Effect.runPromise(service.pathCheck(true))).toEqual({ ok: true, error: null });
    expect(await Effect.runPromise(service.gitCheck())).toMatchObject({
      ok: true,
      executablePath: "/new/bin/git",
    });
  });
  test("only a forced PATH check resolves the shell again", async () => {
    const { userEnvironment, refreshCount } = createRefreshableUserEnvironment("Shell failed.", [
      null,
    ]);
    const service = createSystemDiagnosticsServiceForTest({
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(),
      userEnvironment,
    });
    await Effect.runPromise(service.pathCheck());
    await Effect.runPromise(service.gitCheck());
    expect(refreshCount()).toBe(0);
    expect(await Effect.runPromise(service.pathCheck(true))).toEqual({ ok: true, error: null });
    expect(refreshCount()).toBe(1);
  });
  test("task store diagnostics keep workspace readiness and blocking details", async () => {
    const health: RepoStoreHealth = {
      ...healthyRepoStoreHealth,
      category: "database_unavailable",
      status: "blocking",
      isReady: false,
      detail: "SQLite task store database is unavailable",
    };
    const calls: Array<{ repoPath: string; prepare?: boolean }> = [];
    const service = createSystemDiagnosticsServiceForTest({
      systemCommands: createSystemCommandPort(),
      repoStoreDiagnostics: createTaskStore(health, calls),
    });
    expect(await Effect.runPromise(service.taskStoreCheck("/repo"))).toEqual({
      repoStoreHealth: health,
      taskStoreOk: false,
      taskStorePath: health.databasePath,
      taskStoreError: health.detail,
    });
    expect(calls).toEqual([{ repoPath: "/repo", prepare: true }]);
  });
});
