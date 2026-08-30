import {
  type TerminalCloseResponse,
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListRequestSchema,
  terminalPreparePathInputRequestSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalService } from "../../application/terminals/terminal-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, requireRecord } from "./command-inputs";

export const createTerminalCommandHandlers = (
  terminalService: Pick<TerminalService, "close" | "create" | "list" | "preparePathInput">,
) =>
  ({
    terminal_create: (args) =>
      terminalService.create(
        terminalCreateRequestSchema.parse(
          requireRecord(commandInputRecordSchema.safeParse(args), "terminal_create input"),
        ),
      ),
    terminal_list: (args) =>
      terminalService.list(
        terminalListRequestSchema.parse(
          requireRecord(commandInputRecordSchema.safeParse(args), "terminal_list input"),
        ).filter,
      ),
    terminal_prepare_path_input: (args) =>
      terminalService.preparePathInput(
        terminalPreparePathInputRequestSchema.parse(
          requireRecord(
            commandInputRecordSchema.safeParse(args),
            "terminal_prepare_path_input input",
          ),
        ),
      ),
    terminal_close: (args) =>
      terminalService
        .close(
          terminalCloseRequestSchema.parse(
            requireRecord(commandInputRecordSchema.safeParse(args), "terminal_close input"),
          ),
        )
        .pipe(
          Effect.as({ closed: true } satisfies TerminalCloseResponse),
          Effect.catchIf(
            (failure) => failure.code === "confirmation_required",
            () =>
              Effect.succeed({
                closed: false,
                confirmationRequired: true,
              } satisfies TerminalCloseResponse),
          ),
        ),
  }) satisfies HostCommandHandlerDefinitions;
