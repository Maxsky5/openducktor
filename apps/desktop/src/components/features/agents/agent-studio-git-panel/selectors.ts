import type { InlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";

export const selectDraftCount = (store: InlineCommentDraftStore): number => store.getDraftCount();
export const selectFormatBatch = (store: InlineCommentDraftStore): (() => string) =>
  store.formatBatchMessage;
export const selectClearAll = (store: InlineCommentDraftStore): (() => void) => store.clearAll;
