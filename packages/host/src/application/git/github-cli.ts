import type { SystemCommandPort, SystemCommandRunOptions } from "../../ports/system-command-port";

const GITHUB_CLI_MACHINE_ENV = {
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
  CLICOLOR: "0",
  CLICOLOR_FORCE: "0",
  FORCE_COLOR: "0",
};

const githubCliCommandOptions = (
  options: SystemCommandRunOptions = {},
): SystemCommandRunOptions => ({
  ...options,
  env: {
    ...(options.env ?? {}),
    ...GITHUB_CLI_MACHINE_ENV,
  },
});

export const runGithubCliCommand = (
  systemCommands: SystemCommandPort,
  ghCommand: string,
  args: string[],
  options?: SystemCommandRunOptions,
) => systemCommands.runCommandAllowFailure(ghCommand, args, githubCliCommandOptions(options));

export const readGithubCliVersion = (
  systemCommands: SystemCommandPort,
  ghCommand: string,
  options?: SystemCommandRunOptions,
) => systemCommands.versionCommand(ghCommand, ["--version"], githubCliCommandOptions(options));
