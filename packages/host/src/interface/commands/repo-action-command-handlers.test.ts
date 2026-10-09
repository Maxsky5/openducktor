import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { RepoActionHasNoCommandError } from "../../application/actions/repo-action-command";
import {
  RepoActionNotFoundError,
  type RepoActionService,
} from "../../application/actions/repo-action-service";
import { createRepoActionCommandHandlers } from "./repo-action-command-handlers";

const invokeRunAction = (repoActions: RepoActionService) => {
  const handler = createRepoActionCommandHandlers(repoActions).terminal_run_action;
  return Effect.runPromise(
    Effect.flip(
      handler({
        workingDir: "/repo",
        context: { repoPath: "/repo", taskId: "task-1" },
        actionId: "dev",
      }),
    ),
  );
};

describe("createRepoActionCommandHandlers", () => {
  test("reports action failures with the terminal failure codes", async () => {
    const notFound = new RepoActionNotFoundError({
      actionId: "dev",
      repoPath: "/repo",
      message: "This action no longer exists in the repository settings. Select another action.",
    });
    const noCommand = new RepoActionHasNoCommandError({
      actionName: "Dev",
      message: 'Action "Dev" has no command to run. Lines that start with # are comments.',
    });

    expect(await invokeRunAction({ run: () => Effect.fail(notFound) })).toMatchObject({
      _tag: "TerminalServiceError",
      code: "action_not_found",
      operation: "start_command",
      message: notFound.message,
      cause: notFound,
    });
    expect(await invokeRunAction({ run: () => Effect.fail(noCommand) })).toMatchObject({
      _tag: "TerminalServiceError",
      code: "invalid_input",
      message: noCommand.message,
      cause: noCommand,
    });
  });
});
