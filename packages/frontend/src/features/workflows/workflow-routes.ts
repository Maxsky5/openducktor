/** The Workflows page. */
export const WORKFLOWS_ROUTE = "/workflows";

/** The editor of a workflow: its draft, else its latest version, else the built-in workflow. */
export const workflowPath = (workflowId: string): string =>
  `${WORKFLOWS_ROUTE}/${encodeURIComponent(workflowId)}`;

/** The read-only view of one version. */
export const workflowVersionPath = (workflowId: string, version: number): string =>
  `${workflowPath(workflowId)}/versions/${version}`;
