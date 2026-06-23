import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import type { SystemCommandPort } from "../../../ports/system-command-port";

const WORKFLOW_HOOK_TIMEOUT_MS = 300_000;

const parseHookCommand = (hook: string): string[] => {
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
    throw new HostValidationError({
      field: "hook",
      message: "Invalid hook command syntax. Use argv tokens, or explicitly invoke a shell.",
    });
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new HostValidationError({
      field: "hook",
      message: "Hook command is empty. Provide an executable name.",
    });
  }
  return tokens;
};
export const runHookCommandsAllowFailure = (
  systemCommands: SystemCommandPort,
  hooks: string[],
  cwd: string,
): Effect.Effect<
  {
    hook: string;
    stderr: string;
  } | null,
  never
> =>
  Effect.gen(function* () {
    for (const hook of hooks) {
      let argv: string[];
      try {
        argv = parseHookCommand(hook);
      } catch (error) {
        return {
          hook,
          stderr: errorMessage(error),
        };
      }
      const [command, ...args] = argv;
      if (command === undefined) {
        return { hook, stderr: "Hook command is empty. Provide an executable name." };
      }
      const commandResult = yield* Effect.either(
        systemCommands.runCommandAllowFailure(command, args, {
          cwd,
          timeoutMs: WORKFLOW_HOOK_TIMEOUT_MS,
        }),
      );
      if (commandResult._tag === "Right") {
        const result = commandResult.right;
        if (!result.ok) {
          return { hook, stderr: result.stderr };
        }
      } else {
        return {
          hook,
          stderr: `Failed to execute hook command: ${errorMessage(commandResult.left)}`,
        };
      }
    }
    return null;
  });
