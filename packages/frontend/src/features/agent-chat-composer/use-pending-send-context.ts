import { useMemo } from "react";
import type {
  AgentChatComposerModel,
  AgentChatPendingSendGroup,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import { useBrowserAnnotationComposer } from "@/features/browser-annotations";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { useReviewCommentComposer } from "./use-review-comment-composer";

/**
 * Adds the pending review comments and browser annotations of a task or Workspace Session to
 * the next regular message from any of its sessions. Comments follow the user text, and
 * annotations follow the comments.
 */
export function usePendingSendContext({
  owner,
  workingDirectory,
  onSend,
}: {
  owner: InlineCommentOwner | null;
  /** Source paths inside this directory show relative to it. */
  workingDirectory: string | null;
  onSend: AgentChatComposerModel["onSend"];
}): {
  pendingSendItems: readonly AgentChatPendingSendGroup[];
  onSend: AgentChatComposerModel["onSend"];
} {
  const annotations = useBrowserAnnotationComposer({ owner, workingDirectory, onSend });
  const reviewComments = useReviewCommentComposer({ owner, onSend: annotations.onSend });
  const reviewGroup = reviewComments.pendingSendItems;
  const annotationGroup = annotations.pendingSendItems;
  const pendingSendItems = useMemo(
    () =>
      [reviewGroup, annotationGroup].filter(
        (group): group is AgentChatPendingSendGroup => group !== null,
      ),
    [annotationGroup, reviewGroup],
  );

  return useMemo(
    () => ({ pendingSendItems, onSend: reviewComments.onSend }),
    [pendingSendItems, reviewComments.onSend],
  );
}
