import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useClientConnection } from "../connection/client-connection-react";
import type { WorkspaceSessionDraft } from "./new-workspace-session-draft-store";

export const useNewWorkspaceSessionDraft = (
  draftId: string | null | undefined,
): WorkspaceSessionDraft | null => {
  const { drafts } = useClientConnection();
  const store = drafts.newWorkspaceSessions;
  const readDraft = useCallback(() => (draftId ? store.getDraft(draftId) : null), [draftId, store]);
  return useSyncExternalStore(store.subscribe, readDraft, readDraft);
};

/** Holds a store-owned draft view lease while `active` is true and `draftId` is set. */
export const useDraftViewLease = (draftId: string | null | undefined, active = true): void => {
  const { drafts } = useClientConnection();
  const store = drafts.newWorkspaceSessions;
  useEffect(() => {
    if (!active || !draftId) return;
    return store.attachDraftView(draftId);
  }, [active, draftId, store]);
};

/** Prunes drafts belonging to removed workspaces once workspace records are current. */
export const usePruneRemovedWorkspaceDrafts = ({
  workspaceRecordsAreCurrent,
  openWorkspaceIds,
  closedWorkspaceIds,
}: {
  workspaceRecordsAreCurrent: boolean;
  openWorkspaceIds: readonly string[];
  closedWorkspaceIds: readonly string[];
}): void => {
  const { drafts } = useClientConnection();
  useEffect(() => {
    if (!workspaceRecordsAreCurrent) return;
    const known = new Set<string>([...openWorkspaceIds, ...closedWorkspaceIds]);
    drafts.newWorkspaceSessions.pruneRemovedWorkspaces(known);
  }, [
    closedWorkspaceIds,
    drafts.newWorkspaceSessions,
    openWorkspaceIds,
    workspaceRecordsAreCurrent,
  ]);
};
