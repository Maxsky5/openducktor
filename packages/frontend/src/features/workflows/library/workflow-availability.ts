import type { WorkflowAvailability, WorkspaceRecord } from "@openducktor/contracts";

type NamedWorkspace = Pick<WorkspaceRecord, "workspaceId" | "workspaceName">;

/** The names of the listed workspaces that this host knows, in list order. */
const listedNames = (workspaceIds: readonly string[], workspaces: readonly NamedWorkspace[]) =>
  workspaceIds.flatMap((workspaceId) => {
    const workspace = workspaces.find((candidate) => candidate.workspaceId === workspaceId);
    return workspace ? [workspace.workspaceName] : [];
  });

const nameList = (names: readonly string[]) =>
  names.length <= 2 ? names.join(", ") : `${names.length} repositories`;

/** One line that says which repositories can use a workflow. */
export const availabilitySummary = (
  availability: WorkflowAvailability,
  workspaces: readonly NamedWorkspace[],
): string => {
  if (availability.mode === "all") return "All repositories";
  const names = listedNames(availability.workspaceIds, workspaces);
  if (availability.mode === "only")
    return names.length === 0 ? "No repository" : `Only ${nameList(names)}`;
  return names.length === 0 ? "All repositories" : `All except ${nameList(names)}`;
};

/** Whether no repository of this host can use the workflow. */
export const availableNowhere = (
  availability: WorkflowAvailability,
  workspaces: readonly NamedWorkspace[],
): boolean => {
  if (availability.mode === "all") return false;
  const listed = new Set(availability.workspaceIds);
  const count = workspaces.filter(({ workspaceId }) => listed.has(workspaceId)).length;
  return availability.mode === "only" ? count === 0 : count === workspaces.length;
};

/** Whether a workspace can use a workflow under its availability. */
export const availableTo = (availability: WorkflowAvailability, workspaceId: string): boolean =>
  availability.mode === "all" ||
  (availability.mode === "only") === availability.workspaceIds.includes(workspaceId);
