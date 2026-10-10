import { workspaceSessionLaunchRequestSchema } from "@openducktor/contracts";
import type { WorkspaceSessionLaunchService } from "../../application/workspaces/workspace-session-launch-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseCommandInput } from "./command-inputs";

export const createWorkspaceSessionLaunchCommandHandlers = (
  service: WorkspaceSessionLaunchService,
) =>
  ({
    workspace_session_launch: (args) =>
      service.launch(
        parseCommandInput(workspaceSessionLaunchRequestSchema, args, "workspace_session_launch"),
      ),
  }) satisfies HostCommandHandlerDefinitions;
