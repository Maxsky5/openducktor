import type { GitProviderRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
} from "../../../effect/host-errors";
import { HostValidationError } from "../../../effect/host-errors";
import type {
  SystemCommandPort,
  SystemCommandRunOptions,
} from "../../../ports/system-command-port";
import type { ToolDiscoveryError, ToolDiscoveryPort } from "../../../ports/tool-discovery-port";

const GITHUB_CLI_MACHINE_ENV = {
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
  CLICOLOR: "0",
  CLICOLOR_FORCE: "0",
  FORCE_COLOR: "0",
};

export type GithubCliAuth = {
  authenticated: boolean;
  account: string | null;
  reason: string | null;
};

export type ResolvedGithubCli = {
  executablePath: string;
  getAuth(host: string): Effect.Effect<GithubCliAuth, HostOperationErrorAggregate>;
  readVersion(
    options?: SystemCommandRunOptions,
  ): Effect.Effect<string | null, HostPathAccessErrorAggregate>;
  run(
    args: string[],
    options?: SystemCommandRunOptions,
  ): ReturnType<SystemCommandPort["runCommandAllowFailure"]>;
};

export type GithubCli = {
  resolve(): Effect.Effect<ResolvedGithubCli, ToolDiscoveryError>;
};

export const createGithubCli = ({
  systemCommands,
  toolDiscovery,
}: {
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
}): GithubCli => ({
  resolve: () =>
    toolDiscovery.resolveToolPath("githubCli").pipe(
      Effect.map((executablePath): ResolvedGithubCli => ({
        executablePath,
        getAuth: (host) =>
          systemCommands
            .runCommandAllowFailure(
              executablePath,
              ["api", "user", "--hostname", host, "--jq", ".login"],
              commandOptions(),
            )
            .pipe(
              Effect.map((result) => {
                const output = commandOutput(result.stdout, result.stderr);
                const account = result.stdout.trim() || null;
                return result.ok
                  ? { authenticated: true, account, reason: null }
                  : {
                      authenticated: false,
                      account: null,
                      reason:
                        output || "GitHub authentication is not configured. Run `gh auth login`.",
                    };
              }),
            ),
        readVersion: (options) =>
          systemCommands.versionCommand(executablePath, ["--version"], commandOptions(options)),
        run: (args, options) =>
          systemCommands.runCommandAllowFailure(executablePath, args, commandOptions(options)),
      })),
    ),
});

export const runGithubApi = (
  githubCli: GithubCli,
  repoPath: string,
  host: string,
  args: string[],
) =>
  Effect.gen(function* () {
    const command = yield* githubCli.resolve();
    const hostArgs = host.trim() ? ["--hostname", host.trim(), ...args] : args;
    const result = yield* command.run(hostArgs, { cwd: repoPath });
    if (result.ok) {
      return result.stdout;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "gh",
        message: commandOutput(result.stdout, result.stderr) || "gh command failed.",
        details: { repoPath },
      }),
    );
  });

export const runGithubRepositoryCommandAllowFailure = (
  githubCli: GithubCli,
  repoPath: string,
  repository: GitProviderRepository,
  args: string[],
) =>
  Effect.gen(function* () {
    const command = yield* githubCli.resolve();
    const repositoryName = `${repository.host.trim()}/${repository.owner.trim()}/${repository.name.trim()}`;
    return yield* command.run([...args, "--repo", repositoryName], { cwd: repoPath });
  });

const commandOptions = (options: SystemCommandRunOptions = {}): SystemCommandRunOptions => ({
  ...options,
  env: {
    ...options.env,
    ...GITHUB_CLI_MACHINE_ENV,
  },
});

const commandOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join("\n");
