import type {
  DevServerService,
  DevServerTaskInput,
} from "../../application/dev-servers/dev-server-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseDevServerTaskInput = (args: HostCommandArgs, label: string): DevServerTaskInput => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), label);
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    taskId: requireString(commandInputStringSchema.safeParse(record.taskId), "taskId"),
  };
};

export const createDevServerCommandHandlers = (devServerService: DevServerService) =>
  ({
    dev_server_get_state: (args) =>
      devServerService.getState(parseDevServerTaskInput(args, "dev_server_get_state input")),
    dev_server_restart: (args) =>
      devServerService.restart(parseDevServerTaskInput(args, "dev_server_restart input")),
    dev_server_start: (args) =>
      devServerService.start(parseDevServerTaskInput(args, "dev_server_start input")),
    dev_server_stop: (args) =>
      devServerService.stop(parseDevServerTaskInput(args, "dev_server_stop input")),
  }) satisfies HostCommandHandlerDefinitions;
