import type {
  DevServerService,
  DevServerTaskInput,
} from "../../application/dev-servers/dev-server-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const parseDevServerTaskInput = (
  args: Record<string, unknown> | undefined,
  label: string,
): DevServerTaskInput => {
  const record = requireRecord(args, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
  };
};

export const createDevServerCommandHandlers = (
  devServerService: DevServerService,
): HostCommandHandlers => ({
  dev_server_get_state: (args) =>
    devServerService.getState(parseDevServerTaskInput(args, "dev_server_get_state input")),
  dev_server_restart: (args) =>
    devServerService.restart(parseDevServerTaskInput(args, "dev_server_restart input")),
  dev_server_start: (args) =>
    devServerService.start(parseDevServerTaskInput(args, "dev_server_start input")),
  dev_server_stop: (args) =>
    devServerService.stop(parseDevServerTaskInput(args, "dev_server_stop input")),
});
