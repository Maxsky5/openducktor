import { workspaceProcessStopRequestSchema } from "@openducktor/contracts";
import type { WorkspaceProcessService } from "../../application/processes/workspace-process-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { requireNoArgs } from "./command-inputs";

export const createWorkspaceProcessCommandHandlers = (service: WorkspaceProcessService) =>
  ({
    workspace_processes_list: (args) => {
      requireNoArgs("workspace_processes_list", args);
      return service.list();
    },
    workspace_process_stop: (args) => service.stop(workspaceProcessStopRequestSchema.parse(args)),
  }) satisfies HostCommandHandlerDefinitions;
