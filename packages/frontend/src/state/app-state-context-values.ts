import type { WorkspaceRecord } from "@openducktor/contracts";
import type {
  ChecksStateContextValue,
  DelegationStateContextValue,
  SpecStateContextValue,
  TasksStateContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

type WorkspaceStateValueArgs = Omit<WorkspaceStateContextValue, "activeWorkspace"> & {
  activeWorkspace?: WorkspaceRecord | null;
};

export const buildWorkspaceStateValue = (
  args: WorkspaceStateValueArgs,
): WorkspaceStateContextValue => ({
  ...args,
  activeWorkspace: args.activeWorkspace ?? null,
});

export const buildChecksStateValue = (value: ChecksStateContextValue): ChecksStateContextValue =>
  value;

export const buildTasksStateValue = (value: TasksStateContextValue): TasksStateContextValue =>
  value;

export const buildDelegationStateValue = (
  value: DelegationStateContextValue,
): DelegationStateContextValue => value;

export const buildSpecStateValue = (value: SpecStateContextValue): SpecStateContextValue => value;
