import { normalizeProcessEnvironment } from "./process-environment";
import {
  assertNoWindowsShellNewlines,
  assertSafeWindowsBatchValue,
  buildWindowsBatchEnvCommandLine,
  escapeWindowsQuotedArgumentValue,
} from "./process-windows-command-line";

export type ProcessCommandLaunchPlan = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  windowsVerbatimArguments: boolean;
};

const isWindowsCommandScript = (command: string, platform: NodeJS.Platform): boolean =>
  platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);

const WINDOWS_COMMAND_ENV_NAME = "OPENDUCKTOR_WINDOWS_COMMAND";
const WINDOWS_COMMAND_ARG_ENV_PREFIX = "OPENDUCKTOR_WINDOWS_ARG_";

export const createProcessCommandLaunch = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ProcessCommandLaunchPlan => {
  const launchEnv = normalizeProcessEnvironment(env, platform);

  const isWindowsBatchScript = isWindowsCommandScript(command, platform);
  if (platform === "win32" && !isWindowsBatchScript) {
    assertNoWindowsShellNewlines(command, "command");
  }

  if (!isWindowsBatchScript) {
    return {
      command,
      args,
      env: launchEnv,
      windowsHide: platform === "win32",
      windowsVerbatimArguments: false,
    };
  }

  assertSafeWindowsBatchValue(command, "command");
  const windowsCommandShell = launchEnv.ComSpec?.trim() || "cmd.exe";
  const commandEnv: NodeJS.ProcessEnv = {
    ...launchEnv,
    [WINDOWS_COMMAND_ENV_NAME]: escapeWindowsQuotedArgumentValue(command),
  };
  const argEnvNames = args.map((arg, index) => {
    assertSafeWindowsBatchValue(arg, "argument");
    const envName = `${WINDOWS_COMMAND_ARG_ENV_PREFIX}${index}`;
    commandEnv[envName] = escapeWindowsQuotedArgumentValue(arg);
    return envName;
  });

  return {
    command: windowsCommandShell,
    args: [
      "/d",
      "/v:off",
      "/s",
      "/c",
      buildWindowsBatchEnvCommandLine(WINDOWS_COMMAND_ENV_NAME, argEnvNames),
    ],
    env: commandEnv,
    windowsHide: true,
    windowsVerbatimArguments: true,
  };
};
