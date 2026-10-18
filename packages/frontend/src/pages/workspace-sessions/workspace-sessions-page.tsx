import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useMemo, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessions, type WorkspaceSessionsViewState } from "./workspace-sessions-view";
import { useSessionViewActive } from "@/features/session-navigation/session-view-context";

const WorkspaceSessionsPage = memo(function WorkspaceSessionsPage({
  workspace,
  isWorkspaceReady,
}: {
  workspace: ActiveWorkspace;
  isWorkspaceReady: boolean;
}): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const isActive = useSessionViewActive();
  const records = useQuery({
    ...workspaceSessionListQueryOptions(workspace.workspaceId),
    enabled: isWorkspaceReady,
  });
  const current = useMemo<WorkspaceSessionsViewState | null>(
    () =>
      isWorkspaceReady && records.data !== undefined
        ? {
            workspace,
            sessions: records.data,
            recordsError: records.error,
            searchParams,
            locationKey: location.key,
            navigationType,
          }
        : null,
    [
      isWorkspaceReady,
      location.key,
      navigationType,
      records.data,
      records.error,
      searchParams,
      workspace,
    ],
  );
  const [lastReady, setLastReady] = useState(current);
  if (current !== null && current !== lastReady) setLastReady(current);
  const shown = current ?? lastReady;
  const isVisible = isActive && current !== null;

  return (
    <>
      {isWorkspaceReady && records.isPending ? (
        <p role="status" className="p-6 text-muted-foreground">
          Loading chats…
        </p>
      ) : null}
      {isWorkspaceReady && !records.isPending && records.data === undefined ? (
        <div role="alert" className="space-y-3 p-6">
          <p className="text-destructive">Could not load chats: {errorMessage(records.error)}</p>
          <Button variant="outline" onClick={() => void records.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {/* CSS hiding keeps terminal effects running; hidden Activity would detach them. */}
      <div
        className="h-full min-h-0"
        style={{ display: isVisible ? undefined : "none" }}
        inert={!isVisible}
      >
        {shown ? (
          <WorkspaceSessions
            {...shown}
            isActive={isVisible}
            setSearchParams={setSearchParams}
            retryRecords={() => void records.refetch()}
          />
        ) : null}
      </div>
    </>
  );
});

export default WorkspaceSessionsPage;
