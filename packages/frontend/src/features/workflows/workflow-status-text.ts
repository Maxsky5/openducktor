type WorkflowStatusInput = {
  readonly builtin: boolean;
  readonly routeVersion: number | null;
  readonly hasDraft: boolean;
  readonly latestVersion: number | null;
};

export type StatusTone = "draft" | "published" | "locked";
export type StatusText = { readonly label: string; readonly tone: StatusTone };

/** The one status of a workflow: a draft, a published version, or a read-only view. */
export const workflowStatus = ({
  builtin,
  routeVersion,
  hasDraft,
  latestVersion,
}: WorkflowStatusInput): StatusText => {
  if (builtin) return { label: "Built-in", tone: "locked" };
  if (routeVersion !== null)
    return { label: `Version ${routeVersion} · Read-only`, tone: "locked" };
  if (latestVersion === null) return { label: "Draft", tone: "draft" };
  if (hasDraft) return { label: `Version ${latestVersion} · Unpublished changes`, tone: "draft" };
  return { label: `Version ${latestVersion} · Published`, tone: "published" };
};
