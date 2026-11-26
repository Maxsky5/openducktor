import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useMemo, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessions, type WorkspaceSessionsViewState } from "./workspace-sessions-view";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

function WorkspaceSessionsLoadFallback({
  isPending,
  hasData,
  error,
  onRetry,
}: {
  isPending: boolean;
  hasData: boolean;
  error: Error | null;
  onRetry: () => void;
}): ReactElement | null {
  if (isPending) {
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading sessions…
      </p>
    );
  }
  if (hasData) return null;
  return (
    <div role="alert" className="space-y-3 p-6">
      <p className="text-destructive">Could not load sessions: {errorMessage(error)}</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

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
  const hasDraftParam = searchParams.has("draft");
  const current = useMemo<WorkspaceSessionsViewState | null>(
    () =>
      isWorkspaceReady && (records.data !== undefined || hasDraftParam)
        ? {
            workspace,
            sessions: records.data ?? [],
            recordsError: records.error,
            searchParams,
            locationKey: location.key,
            navigationType,
          }
        : null,
    [
      hasDraftParam,
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
  const isShownVisible =
    current !== null ||
    (records.isPending && shown !== null && shown.workspace.workspaceId === workspace.workspaceId);

  return (
    <>
      {isWorkspaceReady && !hasDraftParam && !isShownVisible ? (
        <WorkspaceSessionsLoadFallback
          isPending={records.isPending}
          hasData={records.data !== undefined}
          error={records.error}
          onRetry={() => void records.refetch()}
        />
      ) : null}
      {/* The session view hides and blocks a view that is not shown. This hides chats that load. */}
      <div className="h-full min-h-0" style={{ display: isShownVisible ? undefined : "none" }}>
        {shown ? (
          <WorkspaceSessions
            {...shown}
            isActive={isActive && isShownVisible}
            setSearchParams={setSearchParams}
            retryRecords={() => void records.refetch()}
          />
        ) : null}
      </div>
    </>
  );
});

export default WorkspaceSessionsPage;
