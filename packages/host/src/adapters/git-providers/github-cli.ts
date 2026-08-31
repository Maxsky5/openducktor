import { Effect } from "effect";
import type { GithubCliPort } from "../../ports/github-cli-port";
import type { SystemCommandPort, SystemCommandRunOptions } from "../../ports/system-command-port";

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

const parseAccount = (output: string): string | null => {
  const marker = "account ";
  const markerIndex = output.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const remainder = output.slice(markerIndex + marker.length).trimStart();
  const account = remainder.split(/[\s(']/)[0]?.trim() ?? "";
  return account.length > 0 ? account : null;
};

export const createGithubCliAdapter = (systemCommands: SystemCommandPort): GithubCliPort => ({
  getAuth: (ghCommand, host) =>
    systemCommands
      .runCommandAllowFailure(
        ghCommand,
        ["auth", "status", "--active", "--hostname", host],
        commandOptions(),
      )
      .pipe(
        Effect.map((result) => {
          const output = commandOutput(result.stdout, result.stderr);
          return result.ok
            ? { authenticated: true, account: parseAccount(output), reason: null }
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
