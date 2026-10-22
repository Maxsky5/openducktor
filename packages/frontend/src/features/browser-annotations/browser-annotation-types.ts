import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";

/**
 * The task or Workspace Session that owns pending browser annotations, across all its sessions.
 * Review comments use the same owners.
 */
export type BrowserAnnotationOwner = InlineCommentOwner;

export type BrowserAnnotationStatus = "pending" | "submitting";
