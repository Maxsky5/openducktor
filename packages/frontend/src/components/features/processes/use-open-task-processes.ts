import { useProcessesActions } from "./processes-context";

/**
 * Opens the Processes view with the checkouts of a task first, after `beforeOpen`, such as a sheet
 * that closes so the flyout beside the rail shows. Undefined for a remote host or without a
 * workspace, so the caller shows no button.
 */
export function useOpenTaskProcesses(
  workspaceId: string | null,
  taskId: string,
  beforeOpen: () => void,
): (() => void) | undefined {
  const actions = useProcessesActions();
  if (!actions || !workspaceId) return undefined;
  return () => {
    beforeOpen();
    actions.openProcesses({ workspaceId, taskId });
  };
}
