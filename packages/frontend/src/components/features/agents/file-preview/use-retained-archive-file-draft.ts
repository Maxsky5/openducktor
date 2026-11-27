import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { connectionOf } from "@openducktor/frontend-core/connection/client-connection";
import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect } from "react";

type DraftState = {
  session: { id: string; baseline: ArchiveFileDraft["baseline"]; branch: string | null } | null;
  draftContents: string;
  isDirty: boolean;
};

/** Keep the consented version available when the editor or the chat leaves the screen. */
export const useRetainedArchiveFileDraft = (
  queryClient: QueryClient,
  workspaceSession: WorkspaceSessionRefInput | undefined,
  archiveDraftRef: { current: ArchiveFileDraft | null } | undefined,
  { session, draftContents, isDirty }: DraftState,
) => {
  const drafts = archiveDraftRef ? connectionOf(queryClient).backgroundOperations : undefined;
  const workspaceId = workspaceSession?.workspaceId;
  const sessionId = workspaceSession?.sessionId;
  useLayoutEffect(() => {
    if (!archiveDraftRef || !workspaceId || !sessionId || !drafts) return;
    const previous = archiveDraftRef.current;
    const current =
      session && isDirty
        ? {
            fileId: session.id,
            contents: draftContents,
            baseline: session.baseline,
            branch: session.branch,
          }
        : null;
    if (previous && previous.fileId === session?.id) {
      if (
        current?.contents === previous.contents &&
        current.baseline === previous.baseline &&
        current.branch === previous.branch
      )
        return;
      drafts.replaceArchiveDraft(workspaceId, sessionId, previous, current ?? undefined);
    }
    archiveDraftRef.current = current;
  }, [archiveDraftRef, draftContents, drafts, isDirty, session, sessionId, workspaceId]);

  return useCallback(
    (fileId: string) => {
      if (!archiveDraftRef || !workspaceId || !sessionId || !drafts) return undefined;
      const draft = drafts.getArchiveDraft(workspaceId, sessionId, fileId);
      if (draft) archiveDraftRef.current = draft;
      return draft;
    },
    [archiveDraftRef, drafts, sessionId, workspaceId],
  );
};
