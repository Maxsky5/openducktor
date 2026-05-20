import { HostValidationError } from "../../effect/host-errors";

export type ProcessCommandLaunchPlan = {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

export type ParsedProcessCommand = {
  command: string;
  args: string[];
};

const quoteWindowsCommandArgument = (value: string): string => {
  if (value.length === 0) {
    return `""`;
  }
  if (!/[\s"%^]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll("^", "^^").replaceAll("%", "%%").replaceAll(`"`, `^"`)}"`;
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
  const shellOptions = ["/d", "/s", "/c"];
  const quotedScriptInvocation = [command, ...args].map(quoteWindowsCommandArgument).join(" ");
  const shellCommandLine = `"${quotedScriptInvocation}"`;

  return {
    command: windowsCommandShell,
    args: [...shellOptions, shellCommandLine],
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

  for (const character of commandLine) {
    if (quote !== null) {
      if (character === quote) {
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
