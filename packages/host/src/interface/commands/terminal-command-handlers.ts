import {
  terminalCloseRequestSchema,
  terminalCreateRequestSchema,
  terminalListRequestSchema,
  terminalPreparePathInputRequestSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TerminalService } from "../../application/terminals/terminal-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord } from "./command-inputs";

export const createTerminalCommandHandlers = (
  terminalService: TerminalService,
): HostCommandHandlers => ({
  terminal_create: (args) =>
    terminalService.create(
      terminalCreateRequestSchema.parse(requireRecord(args, "terminal_create input")),
    ),
  terminal_list: (args) =>
    terminalService.list(
      terminalListRequestSchema.parse(requireRecord(args, "terminal_list input")).filter,
    ),
  terminal_prepare_path_input: (args) =>
    terminalService.preparePathInput(
      terminalPreparePathInputRequestSchema.parse(
        requireRecord(args, "terminal_prepare_path_input input"),
      ),
    ),
  terminal_close: (args) =>
    terminalService
      .close(terminalCloseRequestSchema.parse(requireRecord(args, "terminal_close input")))
      .pipe(
        Effect.as({ closed: true as const }),
        Effect.catchIf(
          (failure) => failure.code === "confirmation_required",
          () => Effect.succeed({ closed: false as const, confirmationRequired: true as const }),
        ),
      ),
});
