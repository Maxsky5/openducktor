import { type RepoAction, repoActionCommandLines } from "@openducktor/contracts";
import { Data, Effect } from "effect";
import type { TerminalCommandLines } from "../terminals/terminal-command";

export class RepoActionHasNoCommandError extends Data.TaggedError("RepoActionHasNoCommandError")<{
  readonly actionName: string;
  readonly message: string;
}> {}

/** The command lines of an action. Fails when the command has only blank or comment lines. */
export const actionCommandLines = (
  action: Pick<RepoAction, "name" | "command">,
): Effect.Effect<TerminalCommandLines, RepoActionHasNoCommandError> => {
  const [firstLine, ...otherLines] = repoActionCommandLines(action.command);
  return firstLine === undefined
    ? Effect.fail(
        new RepoActionHasNoCommandError({
          actionName: action.name,
          message: `Action "${action.name}" has no command to run. Lines that start with # are comments.`,
        }),
      )
    : Effect.succeed([firstLine, ...otherLines]);
};
