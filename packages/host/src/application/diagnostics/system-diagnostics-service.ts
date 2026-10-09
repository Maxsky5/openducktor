import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { RepoStoreDiagnostics, TaskStoreError } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { UserEnvironmentPort } from "../../ports/user-environment-port";

export type SystemDiagnosticsService = {
  pathCheck(forceRefresh?: boolean): Effect.Effect<PathCheck>;
  gitCheck(): Effect.Effect<GitCheck>;
  taskStoreCheck(repoPath: string): Effect.Effect<TaskStoreCheck, TaskStoreError>;
};

export const createSystemDiagnosticsService = ({
  systemCommands,
  toolDiscovery,
  repoStoreDiagnostics,
  userEnvironment,
}: {
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  repoStoreDiagnostics: RepoStoreDiagnostics;
  userEnvironment: UserEnvironmentPort;
}): SystemDiagnosticsService => ({
  pathCheck(forceRefresh = false) {
    return Effect.gen(function* () {
      if (forceRefresh) yield* userEnvironment.refresh();
      const error = userEnvironment.current().error?.message ?? null;
      return { ok: error === null, error };
    });
  },
  gitCheck() {
    return Effect.gen(function* () {
      const discovery = yield* Effect.result(toolDiscovery.discoverTool("git"));
      if (discovery._tag === "Failure") {
        return {
          ok: false,
          executablePath: null,
          version: null,
          error: errorMessage(discovery.failure),
        };
      }
      const executablePath = discovery.success.path;
      const version = yield* Effect.result(
        systemCommands.versionCommand(executablePath, ["--version"], { timeoutMs: 2_000 }),
      );
      if (version._tag === "Failure" || version.success === null) {
        const detail = version._tag === "Failure" ? `: ${errorMessage(version.failure)}` : ".";
        return {
          ok: false,
          executablePath,
          version: null,
          error: `Failed reading git --version from ${executablePath}${detail}`,
        };
      }
      return { ok: true, executablePath, version: version.success, error: null };
    });
  },
  taskStoreCheck(repoPath) {
    return repoStoreDiagnostics.diagnoseRepoStore({ repoPath, prepare: true }).pipe(
      Effect.map((repoStoreHealth): TaskStoreCheck => ({
        repoStoreHealth,
        taskStoreOk: repoStoreHealth.isReady,
        taskStorePath: repoStoreHealth.databasePath,
        taskStoreError: repoStoreHealth.isReady ? null : repoStoreHealth.detail,
      })),
    );
  },
});
