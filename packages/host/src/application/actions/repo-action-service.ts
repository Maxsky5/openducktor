import type { TerminalCreateResponse, TerminalRunActionRequest } from "@openducktor/contracts";
import { Data, Effect } from "effect";
import type { TerminalCommandService } from "../terminals/terminal-command";
import type { TerminalServiceError } from "../terminals/terminal-service-error";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-model";
import { actionCommandLines, type RepoActionHasNoCommandError } from "./repo-action-command";

export class RepoActionNotFoundError extends Data.TaggedError("RepoActionNotFoundError")<{
  readonly actionId: string;
  readonly repoPath: string;
  readonly message: string;
}> {}

export type RepoActionRunError =
  | RepoActionHasNoCommandError
  | RepoActionNotFoundError
  | TerminalServiceError
  | WorkspaceSettingsError;

export type RepoActionService = {
  /** Runs a saved action in a new terminal. The terminal continues as a normal shell. */
  run(request: TerminalRunActionRequest): Effect.Effect<TerminalCreateResponse, RepoActionRunError>;
};

export const createRepoActionService = ({
  terminals,
  settings,
}: {
  terminals: Pick<TerminalCommandService, "startCommand">;
  settings: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}): RepoActionService => ({
  run: (request) =>
    Effect.gen(function* () {
      const repoConfig = yield* settings.getRepoConfigByRepoPath(request.context.repoPath);
      const action = repoConfig.actions.items.find(
        (candidate) => candidate.id === request.actionId,
      );
      if (!action) {
        return yield* new RepoActionNotFoundError({
          actionId: request.actionId,
          repoPath: request.context.repoPath,
          message:
            "This action no longer exists in the repository settings. Select another action.",
        });
      }
      const commandLines = yield* actionCommandLines(action);
      const started = yield* terminals.startCommand({
        context: request.context,
        workingDir: request.workingDir,
        label: action.name,
        commandLines,
        startedBy: "user",
      });
      return started.response;
    }),
});
