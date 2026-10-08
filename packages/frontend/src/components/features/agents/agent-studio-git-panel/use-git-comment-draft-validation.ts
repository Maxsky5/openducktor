import { useEffect } from "react";
import {
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import type { AgentStudioGitPanelModel } from "./types";

export function useGitCommentDraftValidation(
  model: Pick<
    AgentStudioGitPanelModel,
    | "commentOwner"
    | "targetBranch"
    | "comparisonUnavailableReason"
    | "scopeStatesByScope"
    | "loadedScopesByScope"
  >,
): void {
  const ownerKey = toInlineCommentDraftOwnerKey(model.commentOwner ?? null);
  const hydrated = useInlineCommentDraftStore(
    (store) => ownerKey !== null && store.hydratedOwners[ownerKey] === true,
  );
  useEffect(() => {
    if (ownerKey !== null) useInlineCommentDraftStore.getState().hydrate(ownerKey);
  }, [ownerKey]);
  useEffect(() => {
    if (ownerKey === null || !hydrated) return;
    for (const scope of ["uncommitted", "target"] as const) {
      if (scope === "target" && (!model.targetBranch || model.comparisonUnavailableReason))
        continue;
      const state = model.scopeStatesByScope[scope];
      if (!model.loadedScopesByScope[scope] || state.error !== null) continue;
      useInlineCommentDraftStore
        .getState()
        .dropDraftsForMissingFiles(
          ownerKey,
          scope,
          new Set(state.fileDiffs.map((diff) => diff.file)),
        );
    }
  }, [
    ownerKey,
    hydrated,
    model.loadedScopesByScope,
    model.scopeStatesByScope,
    model.targetBranch,
    model.comparisonUnavailableReason,
  ]);
}
