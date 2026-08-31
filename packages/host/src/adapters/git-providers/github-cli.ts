import { Effect } from "effect";
import type { GithubCliPort, GithubCommandResolverPort } from "../../ports/github-cli-port";
import type { SystemCommandPort, SystemCommandRunOptions } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

const GITHUB_CLI_MACHINE_ENV = {
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
  CLICOLOR: "0",
  CLICOLOR_FORCE: "0",
  FORCE_COLOR: "0",
};

const commandOptions = (options: SystemCommandRunOptions = {}): SystemCommandRunOptions => ({
  ...options,
  env: {
    ...options.env,
    ...GITHUB_CLI_MACHINE_ENV,
  },
});

const commandOutput = (stdout: string, stderr: string): string =>
  [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join("\n");

export const createGithubCliAdapter = (systemCommands: SystemCommandPort): GithubCliPort => ({
  getAuth: (ghCommand, host) =>
    systemCommands
      .runCommandAllowFailure(
        ghCommand,
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
                reason: output || "GitHub authentication is not configured. Run `gh auth login`.",
              };
        }),
      ),
  readVersion: (ghCommand, options) =>
    systemCommands.versionCommand(ghCommand, ["--version"], commandOptions(options)),
  run: (ghCommand, args, options) =>
    systemCommands.runCommandAllowFailure(ghCommand, args, commandOptions(options)),
});

export const createGithubCommandResolver = ({
  githubCli,
  toolDiscovery,
}: {
  githubCli: GithubCliPort;
  toolDiscovery: ToolDiscoveryPort;
}): GithubCommandResolverPort => ({
  resolve: () =>
    toolDiscovery
      .resolveToolPath("githubCli")
      .pipe(Effect.map((ghCommand) => ({ ghCommand, githubCli }))),
});
