import type { GitCheck, PathCheck, TaskStoreCheck } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { RepoStoreDiagnostics, TaskStoreError } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { UserEnvironmentPort } from "../../ports/user-environment-port";

/** Merge detection reads `for-each-ref --format=%(ahead-behind:...)`, which Git 2.41 added. */
const MINIMUM_GIT_VERSION = { major: 2, minor: 41 } as const;

/** Why a `git --version` output is below the version that OpenDucktor needs, or null. */
const gitVersionError = (version: string): string | null => {
  const match = /(\d+)\.(\d+)/.exec(version);
  if (!match) return `Unable to read the Git version from "${version}".`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const { major: minimumMajor, minor: minimumMinor } = MINIMUM_GIT_VERSION;
  if (major > minimumMajor || (major === minimumMajor && minor >= minimumMinor)) return null;
  return `Git ${minimumMajor}.${minimumMinor} or later is required, and Git ${major}.${minor} is installed. Update Git.`;
};

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
      const error = gitVersionError(version.success);
      return { ok: error === null, executablePath, version: version.success, error };
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
