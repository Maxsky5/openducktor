import type { CodexAppServerService } from "./codex-app-server-service";
import type { HostCommandHandlers } from "./host-command-router";

export const createCodexAppServerCommandHandlers = (
  codexAppServerService: CodexAppServerService,
): HostCommandHandlers => ({
  codex_app_server_request: (args) => codexAppServerService.request(args),
  codex_app_server_notifications: (args) => codexAppServerService.notifications(args),
  codex_app_server_requests: (args) => codexAppServerService.requests(args),
  codex_app_server_respond: (args) => codexAppServerService.respond(args),
});
