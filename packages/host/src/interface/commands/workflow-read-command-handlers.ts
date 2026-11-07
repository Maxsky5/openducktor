import type { createWorkflowReads } from "../../application/tasks/workflow-reads";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseRepoPathInput } from "./task-command-inputs";

export const createWorkflowReadCommandHandlers = (reads: ReturnType<typeof createWorkflowReads>) =>
  ({
    workflow_catalog_get: () => reads.catalog(),
    workspace_workflow_get: (args) =>
      reads.workspace(parseRepoPathInput(args, "workspace_workflow_get input")),
  }) satisfies HostCommandHandlerDefinitions;
