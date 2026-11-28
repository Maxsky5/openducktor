import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { connectionOf } from "@openducktor/frontend-core/connection/client-connection";
import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

type DraftState = {
  session: { id: string; baseline: ArchiveFileDraft["baseline"]; branch: string | null } | null;
  draftContents: string;
  isDirty: boolean;
};

/** Keep edits available when archive closes the editor or the chat. */
export const useRetainedArchiveFileDraft = (
  queryClient: QueryClient,
  workspaceSession: WorkspaceSessionRefInput | undefined,
  archiveDraftRef: { current: ArchiveFileDraft | null } | undefined,
) => {
  const drafts = archiveDraftRef ? connectionOf(queryClient).backgroundOperations : undefined;
  const workspaceId = workspaceSession?.workspaceId;
  const sessionId = workspaceSession?.sessionId;
  const syncArchiveDraft = useCallback(
    ({ session, draftContents, isDirty }: DraftState) => {
      if (!archiveDraftRef || !workspaceId || !sessionId || !drafts) return;
      const previous = archiveDraftRef.current;
      const sameFile = previous?.fileId === session?.id;
      const current =
        session && isDirty
          ? {
              fileId: session.id,
              contents: draftContents,
              baseline: session.baseline,
              branch: session.branch,
            }
          : null;
      if (
        sameFile &&
        previous &&
        current?.contents === previous.contents &&
        current.baseline === previous.baseline &&
        current.branch === previous.branch
      )
        return;
      drafts.replaceArchiveDraft(
        workspaceId,
        sessionId,
        sameFile ? previous : null,
        current ?? undefined,
      );
      archiveDraftRef.current = current;
    },
    [archiveDraftRef, drafts, sessionId, workspaceId],
  );

  const readRetainedDraft = useCallback(
    (fileId: string) => {
      if (!archiveDraftRef || !workspaceId || !sessionId || !drafts) return undefined;
      const draft = drafts.getArchiveDraft(workspaceId, sessionId, fileId);
      if (draft) archiveDraftRef.current = draft;
      return draft;
    },
    [archiveDraftRef, drafts, sessionId, workspaceId],
  );
  return { readRetainedDraft, syncArchiveDraft };
};
