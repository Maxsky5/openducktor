import type { WorkspaceRecord } from "@openducktor/contracts";
import { useRouter } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { HostConnectionState, useHostUnavailable } from "@/host-session/host-connection-state";
import { routes } from "@/navigation/routes";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { usePendingAction } from "@/ui/use-pending-action";

/**
 * The host has no open workspace. Mobile cannot open one, so the user goes to another client.
 * Check Again shows its progress. A failed check sets the error of the workspace list, so the
 * parent view replaces this state with the failure and its retry.
 */
export function NoOpenWorkspaceState(): ReactElement {
  const { refreshWorkspaces } = useMobileWorkspaces();
  const check = usePendingAction(refreshWorkspaces, haptics.error);
  return (
    <EmptyState
      icon="folder-open"
      title="No Open Workspace"
      message="Open a workspace in the desktop or web app, then check again."
      action={
        <Button
          label="Check Again"
          icon="refresh"
          variant="tinted"
          loading={check.pending}
          onPress={check.run}
        />
      }
    />
  );
}

/**
 * Renders a selected-workspace view only when the host lists a workspace. Tasks, Archived Chats,
 * and the workflow sheets use it for their loading, failure, and no-workspace states.
 */
export function SelectedWorkspaceGate({
  loading,
  children,
}: {
  /** The first-load placeholder, such as skeleton rows in the layout of the list that loads. */
  loading?: ReactElement | undefined;
  children: (workspace: WorkspaceRecord) => ReactNode;
}): ReactNode {
  const router = useRouter();
  const { selectedWorkspace, isLoading, error, refreshWorkspaces } = useMobileWorkspaces();
  const hostUnavailable = useHostUnavailable();
  if (selectedWorkspace) return children(selectedWorkspace);
  // Without a host, the workspace read fails for that reason only, so the screen says so once.
  if (hostUnavailable) return <HostConnectionState />;
  if (isLoading) return loading ?? <LoadingState label="Loading workspaces" />;
  if (error) {
    return (
      <ErrorState
        title="Workspaces did not load"
        message={error}
        onRetry={refreshWorkspaces}
        action={
          <Button
            label="Choose Workspace"
            variant="plain"
            onPress={() => router.push(routes.workspaceSwitcher())}
          />
        }
      />
    );
  }
  return <NoOpenWorkspaceState />;
}

/** A sheet of a workspace that is not the selected one. */
export function OtherWorkspaceState(): ReactElement {
  return (
    <EmptyState
      icon="link-off"
      title="Another Workspace Is Selected"
      message="This sheet belongs to another workspace. Close it, select that workspace, and open the sheet again."
    />
  );
}
