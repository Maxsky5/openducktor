import { useEffect } from "react";
import { useClientConnection } from "../connection/client-connection-react";
import { toInlineCommentDraftOwnerKey } from "../drafts/inline-comment-draft-store";
import type { InlineCommentOwner } from "../drafts/inline-comment-owner";
import { useInlineCommentDraftStore } from "../drafts/use-inline-comment-draft-store";
import type { DiffDataState } from "./contracts";

export type GitCommentDraftValidationInput = Pick<
  DiffDataState,
  "scopeStatesByScope" | "loadedScopesByScope"
> & {
  commentOwner?: InlineCommentOwner | null | undefined;
  comparisonUnavailableReason?: string | null | undefined;
  /** The checked comparison target. Branch changes validate comments only when it is set. */
  targetBranch: string | null;
};

/**
 * Hydrates the inline comments of an owner and drops restored comments whose file is missing from
 * a loaded diff scope. Loading, failed reads, and unavailable comparisons keep the comments.
 */
export function useGitCommentDraftValidation(model: GitCommentDraftValidationInput): void {
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
