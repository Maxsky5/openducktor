import type { HostCommandHandlers } from "./host-command-router";
import type { OpenInToolsService } from "./open-in-tools-service";

export const createOpenInToolsCommandHandlers = (
  service: OpenInToolsService,
): HostCommandHandlers => ({
  system_list_open_in_tools: (args) => service.listOpenInTools(args),
  system_open_directory_in_tool: async (args) => {
    await service.openDirectoryInTool(args);
    return { ok: true };
  },
  open_external_url: async (args) => {
    await service.openExternalUrl(args);
    return { ok: true };
  },
});
