import { HostValidationError } from "../../effect/host-errors";

type ProcessCommandLaunchPlan = {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

type ParsedProcessCommand = {
  command: string;
  args: string[];
};

const isWindowsCommandScript = (command: string, platform: NodeJS.Platform): boolean =>
  platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);

export const createProcessCommandLaunch = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ProcessCommandLaunchPlan => {
  if (!isWindowsCommandScript(command, platform)) {
    return { command, args };
  }

  const windowsCommandShell = env.ComSpec?.trim() || "cmd.exe";

  return {
    command: windowsCommandShell,
    args: ["/d", "/c", "call", command, ...args],
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
