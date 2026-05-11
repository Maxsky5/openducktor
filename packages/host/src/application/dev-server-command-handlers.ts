import type { DevServerService } from "./dev-server-service";
import type { HostCommandHandlers } from "./host-command-router";

export const createDevServerCommandHandlers = (
  devServerService: DevServerService,
): HostCommandHandlers => ({
  dev_server_get_state: (args) => devServerService.getState(args),
  dev_server_restart: (args) => devServerService.restart(args),
  dev_server_start: (args) => devServerService.start(args),
  dev_server_stop: (args) => devServerService.stop(args),
});
