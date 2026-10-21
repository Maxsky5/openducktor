import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import {
  type AgentChatComposerDraft,
  appendAttachmentsToDraft,
  appendTextToDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { sendWithPendingItems } from "@/components/features/agents/agent-chat/agent-chat-pending-send";
import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import type {
  AgentChatComposerModel,
  AgentChatPendingSendGroup,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import {
  BROWSER_ANNOTATION_IMAGE_MIME,
  browserAnnotationImageName,
  browserAnnotationSendImage,
  buildBrowserAnnotationAttachments,
  formatBrowserAnnotationsMessage,
} from "./browser-annotation-message";
import {
  type BrowserAnnotation,
  type BrowserAnnotationStore,
  useBrowserAnnotationStore,
  useBrowserAnnotations,
} from "./browser-annotation-store";
import type { BrowserAnnotationOwner } from "./browser-annotation-types";

/** Adds the pending annotations of the owner to the next regular message. */
export function useBrowserAnnotationComposer({
  owner,
  workingDirectory,
  onSend,
}: {
  owner: BrowserAnnotationOwner | null;
  workingDirectory: string | null;
  onSend: AgentChatComposerModel["onSend"];
}): {
  pendingSendItems: AgentChatPendingSendGroup | null;
  onSend: AgentChatComposerModel["onSend"];
} {
  const annotationStore = useBrowserAnnotationStore();
  const { ownerKey, annotations } = useBrowserAnnotations(owner);
  const pendingSendItems = useMemo(
    () => buildBrowserAnnotationSendGroup(annotations),
    [annotations],
  );
  const submitDraft = useCallback(
    (draft: AgentChatComposerDraft, mode: AgentMessageSubmitMode): Promise<AgentChatSendResult> =>
      ownerKey === null
        ? onSend(draft, mode)
        : sendWithPendingItems(draft, mode, onSend, {
            itemName: "annotation",
            lock: (current) =>
              lockBrowserAnnotations(
                annotationStore.getState(),
                ownerKey,
                current,
                workingDirectory,
              ),
            complete: (submissionId) =>
              annotationStore.getState().completeSubmittingAnnotations(submissionId),
            restore: (submissionId) =>
              annotationStore.getState().restoreSubmittingAnnotations(submissionId),
          }),
    [annotationStore, onSend, ownerKey, workingDirectory],
  );

  return useMemo(
    () => ({ pendingSendItems, onSend: submitDraft }),
    [pendingSendItems, submitDraft],
  );
}

/** The Send button count and the image files that the next message adds. */
export const buildBrowserAnnotationSendGroup = (
  annotations: readonly BrowserAnnotation[],
): AgentChatPendingSendGroup | null => {
  const pending = annotations.filter((annotation) => annotation.status === "pending");
  if (pending.length === 0) return null;

  const count = pending.length;
  const group: AgentChatPendingSendGroup = {
    key: "browser_annotations",
    count,
    accessibleLabel: `${count} pending browser ${count === 1 ? "annotation" : "annotations"}`,
  };
  const withImages = pending.filter(
    (annotation) => browserAnnotationSendImage(annotation) !== null,
  );
  if (withImages.length > 0) {
    group.attachments = {
      items: withImages.map((annotation) => ({
        kind: "image",
        mime: BROWSER_ANNOTATION_IMAGE_MIME,
        name: browserAnnotationImageName(annotation),
      })),
      removalHint: "Edit the annotations, and turn off Screenshot.",
    };
  }
  return group;
};

/** Adds the pending annotations after the user text, with their images, and locks them. */
const lockBrowserAnnotations = (
  store: BrowserAnnotationStore,
  ownerKey: string,
  draft: AgentChatComposerDraft,
  workingDirectory: string | null,
) => {
  const pending = store.getPendingAnnotations(ownerKey);
  const markdown = formatBrowserAnnotationsMessage(pending, workingDirectory);
  const attachments = buildBrowserAnnotationAttachments(pending);
  const withText = markdown.length > 0 ? appendTextToDraft(draft, markdown) : draft;
  return {
    message: attachments.length > 0 ? appendAttachmentsToDraft(withText, attachments) : withText,
    submissionId: store.beginSubmittingAnnotations(
      ownerKey,
      pending.map(({ id, revision }) => ({ id, revision })),
    ),
  };
};
