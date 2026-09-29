import { type DevServerCommandInput, devServerCommandInputSchema } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { DevServerService } from "../../application/dev-servers/dev-server-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, type HostCommandArgs, requireRecord } from "./command-inputs";

const parseInput = (args: HostCommandArgs, label: string): DevServerCommandInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), label);
  const parsed = devServerCommandInputSchema.safeParse(record);
  if (!parsed.success) {
    throw new HostValidationError({
      field: "owner",
      message: `${label} requires a repository path and a task or Workspace Session owner.`,
      cause: parsed.error,
    });
  }
  return parsed.data;
};

export const createDevServerCommandHandlers = (devServerService: DevServerService) =>
  ({
    dev_server_get_state: (args) =>
      devServerService.getState(parseInput(args, "dev_server_get_state input")),
    dev_server_restart: (args) =>
      devServerService.restart(parseInput(args, "dev_server_restart input")),
    dev_server_start: (args) => devServerService.start(parseInput(args, "dev_server_start input")),
    dev_server_stop: (args) => devServerService.stop(parseInput(args, "dev_server_stop input")),
  }) satisfies HostCommandHandlerDefinitions;
