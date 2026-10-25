import type { WorkspaceRecord } from "@openducktor/contracts";
import type { ChecksStateContextValue, WorkspaceStateContextValue } from "@/types/state-slices";

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
