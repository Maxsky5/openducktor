import { useStore } from "zustand";
import { useClientConnection } from "../connection/client-connection-react";
import type { InlineCommentDraftStore } from "./inline-comment-draft-store";

/** Selects from the inline comment drafts of this host connection. */
export const useInlineCommentDraftStore = <T>(selector: (state: InlineCommentDraftStore) => T): T =>
  useStore(useClientConnection().drafts.inlineComments, selector);
