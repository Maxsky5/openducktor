import { useEffect } from "react";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useInlineCommentDraftStore } from "@openducktor/frontend-core/drafts/use-inline-comment-draft-store";
import type { AgentStudioGitPanelModel } from "./types";

export function useGitCommentDraftValidation(
  model: Pick<
    AgentStudioGitPanelModel,
    "commentOwner" | "comparisonUnavailableReason" | "scopeStatesByScope" | "loadedScopesByScope"
  > & { targetBranch: string | null },
): void {
  const ownerKey = toInlineCommentDraftOwnerKey(model.commentOwner ?? null);
  const inlineComments = useClientConnection().drafts.inlineComments;
  const hydrated = useInlineCommentDraftStore(
    (store) => ownerKey !== null && store.hydratedOwners[ownerKey] === true,
  );
  useEffect(() => {
    if (ownerKey !== null) inlineComments.getState().hydrate(ownerKey);
  }, [inlineComments, ownerKey]);
  useEffect(() => {
    if (ownerKey === null || !hydrated) return;
    for (const scope of ["uncommitted", "target"] as const) {
      if (scope === "target" && (!model.targetBranch || model.comparisonUnavailableReason))
        continue;
      const state = model.scopeStatesByScope[scope];
      if (!model.loadedScopesByScope[scope] || state.error !== null) continue;
      inlineComments
        .getState()
        .dropDraftsForMissingFiles(
          ownerKey,
          scope,
          new Set(state.fileDiffs.map((diff) => diff.file)),
        );
    }
  }, [
    inlineComments,
    ownerKey,
    hydrated,
    model.loadedScopesByScope,
    model.scopeStatesByScope,
    model.targetBranch,
    model.comparisonUnavailableReason,
  ]);
}
