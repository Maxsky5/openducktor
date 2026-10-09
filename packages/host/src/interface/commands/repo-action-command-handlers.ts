import { terminalRunActionRequestSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { RepoActionService } from "../../application/actions/repo-action-service";
import { TerminalServiceError } from "../../application/terminals/terminal-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, requireRecord } from "./command-inputs";

export const createRepoActionCommandHandlers = (repoActions: RepoActionService) =>
  ({
    terminal_run_action: (args) =>
      repoActions
        .run(
          terminalRunActionRequestSchema.parse(
            requireRecord(commandInputRecordSchema.safeParse(args), "terminal_run_action input"),
          ),
        )
        .pipe(
          // A run opens a terminal, so its failures use the terminal failure contract.
          Effect.catchTags({
            RepoActionNotFoundError: (cause) =>
              Effect.fail(
                new TerminalServiceError({
                  code: "action_not_found",
                  operation: "start_command",
                  message: cause.message,
                  cause,
                }),
              ),
            RepoActionHasNoCommandError: (cause) =>
              Effect.fail(
                new TerminalServiceError({
                  code: "invalid_input",
                  operation: "start_command",
                  message: cause.message,
                  cause,
                }),
              ),
          }),
        ),
  }) satisfies HostCommandHandlerDefinitions;
