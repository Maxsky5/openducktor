import type { RepoAction } from "@openducktor/contracts";
import { Data, Effect } from "effect";
import type { TerminalCommandLines } from "../terminals/terminal-command";

export class RepoActionHasNoCommandError extends Data.TaggedError("RepoActionHasNoCommandError")<{
  readonly actionName: string;
  readonly message: string;
}> {}

/**
 * Each non-blank line of an action is one command. Lines that start with `#` are skipped, because
 * an interactive zsh runs `#` as a command.
 */
export const actionCommandLines = (
  action: Pick<RepoAction, "name" | "command">,
): Effect.Effect<TerminalCommandLines, RepoActionHasNoCommandError> => {
  const [firstLine, ...otherLines] = action.command
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return firstLine === undefined
    ? Effect.fail(
        new RepoActionHasNoCommandError({
          actionName: action.name,
          message: `Action "${action.name}" has no command to run. Lines that start with # are comments.`,
        }),
      )
    : Effect.succeed([firstLine, ...otherLines]);
};
