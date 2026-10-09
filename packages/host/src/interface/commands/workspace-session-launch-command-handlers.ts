import {
  workspaceSessionLaunchReadSchema,
  workspaceSessionLaunchRefSchema,
  workspaceSessionLaunchRequestSchema,
} from "@openducktor/contracts";
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
    workspace_session_launch_read: (args) =>
      service.read(
        parseCommandInput(workspaceSessionLaunchReadSchema, args, "workspace_session_launch_read"),
      ),
    workspace_session_launch_recover: (args) =>
      service.recover(
        parseCommandInput(
          workspaceSessionLaunchRefSchema,
          args,
          "workspace_session_launch_recover",
        ),
      ),
    workspace_session_launch_cancel: (args) =>
      service.cancel(
        parseCommandInput(workspaceSessionLaunchRefSchema, args, "workspace_session_launch_cancel"),
      ),
  }) satisfies HostCommandHandlerDefinitions;
