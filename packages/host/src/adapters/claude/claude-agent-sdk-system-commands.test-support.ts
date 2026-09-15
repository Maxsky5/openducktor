import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";

export const CLAUDE_TEST_VERSION_OUTPUT = "2.1.251 (Claude Code)";

export const createClaudeSystemCommands = (
  versionOutput: string | null = CLAUDE_TEST_VERSION_OUTPUT,
): SystemCommandPort => ({
  resolveCommandPath: () => Effect.succeed(null),
  versionCommand: () => Effect.succeed(versionOutput),
  runCommandAllowFailure: () => Effect.die("unexpected runCommandAllowFailure"),
});

export const createRecordingClaudeSystemCommands = (
  versionOutput: string | null = CLAUDE_TEST_VERSION_OUTPUT,
) => {
  const versionCalls: Array<Parameters<SystemCommandPort["versionCommand"]>> = [];
  return {
    versionCalls,
    systemCommands: {
      resolveCommandPath: () => Effect.succeed(null),
      versionCommand: (...input: Parameters<SystemCommandPort["versionCommand"]>) => {
        versionCalls.push(input);
        return Effect.succeed(versionOutput);
      },
      runCommandAllowFailure: () => Effect.die("unexpected runCommandAllowFailure"),
    },
  };
};
