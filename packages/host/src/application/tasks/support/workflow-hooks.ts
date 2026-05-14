import type { SystemCommandPort } from "../../../ports/system-command-port";

export const parseHookCommand = (hook: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const character of hook) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote !== null) {
    throw new Error("Invalid hook command syntax. Use argv tokens, or explicitly invoke a shell.");
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new Error("Hook command is empty. Provide an executable name.");
  }

  return tokens;
};

export const runHookCommandsAllowFailure = async (
  systemCommands: SystemCommandPort,
  hooks: string[],
  cwd: string,
): Promise<{ hook: string; stderr: string } | null> => {
  for (const hook of hooks) {
    let argv: string[];
    try {
      argv = parseHookCommand(hook);
    } catch (error) {
      return {
        hook,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }

    const [command, ...args] = argv;
    if (command === undefined) {
      return { hook, stderr: "Hook command is empty. Provide an executable name." };
    }
    try {
      const result = await systemCommands.runCommandAllowFailure(command, args, { cwd });
      if (!result.ok) {
        return { hook, stderr: result.stderr };
      }
    } catch (error) {
      return {
        hook,
        stderr: `Failed to execute hook command: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  return null;
};
