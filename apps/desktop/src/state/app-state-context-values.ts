import type {
  AgentStateContextValue,
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";
import type { WorkspaceRecord } from "@openducktor/contracts";

type WorkspaceStateValueArgs = Omit<WorkspaceStateContextValue, "activeWorkspace"> & {
  activeWorkspace?: WorkspaceRecord | null;
};

export const findActiveWorkspace = (
  workspaces: WorkspaceRecord[],
  activeRepo: string | null,
): WorkspaceRecord | null => workspaces.find((workspace) => workspace.path === activeRepo) ?? null;

export const buildWorkspaceStateValue = (
  args: WorkspaceStateValueArgs,
): WorkspaceStateContextValue => ({
  ...args,
  activeWorkspace: args.activeWorkspace ?? findActiveWorkspace(args.workspaces, args.activeRepo),
});

export const buildChecksStateValue = (value: ChecksStateContextValue): ChecksStateContextValue =>
  value;

export const buildTasksStateValue = (value: TasksStateContextValue): TasksStateContextValue =>
  value;

export const buildDelegationStateValue = (
  value: DelegationStateContextValue,
): DelegationStateContextValue => value;

export const buildSpecStateValue = (value: SpecStateContextValue): SpecStateContextValue => value;

export const buildAgentStateValue = (value: AgentStateContextValue): AgentStateContextValue =>
  value;
