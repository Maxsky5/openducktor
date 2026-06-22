import { HostValidationError } from "../../effect/host-errors";
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

type ParsedProcessCommand = {
  command: string;
  args: string[];
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

const commandSyntaxError = (message: string, commandLine: string): HostValidationError =>
  new HostValidationError({
    field: "command",
    message,
    details: { command: commandLine },
  });

export const parseProcessCommandLine = (commandLine: string): ParsedProcessCommand => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | `"` | null = null;
  let currentTokenStarted = false;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine.charAt(index);

    if (quote !== null) {
      const nextCharacter = commandLine.charAt(index + 1);
      if (character === "\\" && (nextCharacter === quote || nextCharacter === "\\")) {
        current += nextCharacter;
        index += 1;
      } else if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      currentTokenStarted = true;
      continue;
    }

    if (character === `"` || character === "'") {
      quote = character;
      currentTokenStarted = true;
      continue;
    }

    if (/\s/u.test(character)) {
      if (currentTokenStarted) {
        tokens.push(current);
        current = "";
        currentTokenStarted = false;
      }
      continue;
    }

    current += character;
    currentTokenStarted = true;
  }

  if (quote !== null) {
    throw commandSyntaxError(
      "Dev server command has an unmatched quote. Fix the command syntax or invoke a shell explicitly.",
      commandLine,
    );
  }

  if (currentTokenStarted) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;
  if (!command) {
    throw commandSyntaxError("Dev server command is empty. Provide a command to run.", commandLine);
  }

  return { command, args };
};
