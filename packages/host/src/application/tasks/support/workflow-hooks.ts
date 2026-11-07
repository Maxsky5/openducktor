import { Effect } from "effect";
import {
  errorMessage,
  HostDependencyError,
  HostValidationError,
} from "../../../effect/host-errors";
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
const commandOutput = (stdout: string, stderr: string): string =>
  [stdout, stderr]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
/** Runs the hooks in order. Returns the first failed hook and its output, or null. */
const runHookCommandsAllowFailure = (
  systemCommands: SystemCommandPort,
  hooks: readonly string[],
  cwd: string,
): Effect.Effect<{ hook: string; output: string } | null, never> =>
  Effect.gen(function* () {
    for (const hook of hooks) {
      let argv: string[];
      try {
        argv = parseHookCommand(hook);
      } catch (error) {
        return { hook, output: errorMessage(error) };
      }
      const [command, ...args] = argv;
      if (command === undefined) {
        return { hook, output: "Hook command is empty. Provide an executable name." };
      }
      const commandResult = yield* Effect.result(
        systemCommands.runCommandAllowFailure(command, args, {
          cwd,
          timeoutMs: WORKFLOW_HOOK_TIMEOUT_MS,
        }),
      );
      if (commandResult._tag === "Failure") {
        return {
          hook,
          output: `Failed to execute hook command: ${errorMessage(commandResult.failure)}`,
        };
      }
      const result = commandResult.success;
      if (!result.ok) {
        const output = commandOutput(result.stdout, result.stderr);
        const exit = result.exitCode == null ? "" : `\nExit code ${result.exitCode}.`;
        return { hook, output: `${output}${exit}` };
      }
    }
    return null;
  });

/** The repository commands that run in a task worktree right before the host removes it. */
export type BeforeWorktreeRemovalScript = {
  commands: readonly string[];
  systemCommands: SystemCommandPort | undefined;
};

/** Runs the before worktree removal script in the worktree. A failed command fails the removal. */
export const runBeforeWorktreeRemovalScript = (
  script: BeforeWorktreeRemovalScript,
  worktreePath: string,
) =>
  Effect.gen(function* () {
    const commands = script.commands.map((command) => command.trim()).filter(Boolean);
    if (commands.length === 0) {
      return;
    }
    if (!script.systemCommands) {
      return yield* new HostDependencyError({
        dependency: "systemCommands",
        operation: "before worktree removal script",
        message: "System command port is required to run the before worktree removal script.",
      });
    }
    const failure = yield* runHookCommandsAllowFailure(
      script.systemCommands,
      commands,
      worktreePath,
    );
    if (failure !== null) {
      return yield* new HostValidationError({
        field: "hooks.beforeWorktreeRemoval",
        message: `Before worktree removal script command failed: ${failure.hook}\n${failure.output}\nOpenDucktor kept the worktree ${worktreePath}. Fix the command in the repository settings or its cause, then try again.`,
        details: { worktreePath, hook: failure.hook },
      });
    }
  });
