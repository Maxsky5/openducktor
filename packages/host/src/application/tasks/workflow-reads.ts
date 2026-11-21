import type { WorkspaceRef } from "@openducktor/contracts";
import type { WorkspaceWorkflowPort } from "../../ports/task-workflow-port";

/** The workflow catalog and the workspace workflow context of the host. */
export const createWorkflowReads = (
  workspaceWorkflows: Pick<WorkspaceWorkflowPort, "catalog" | "context">,
) => ({
  catalog: () => workspaceWorkflows.catalog(),
  workspace: (scope: WorkspaceRef) => workspaceWorkflows.context(scope),
});
