import type { ReactElement } from "react";
import { toast } from "sonner";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_PICKER_TYPES,
  readAttachmentFileName,
} from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import type { ComposerPolicy } from "@openducktor/frontend-core/sessions/composer/agent-chat-composer-policy";
import { buildComposerAttachmentFromFile } from "./agent-chat-attachment-files";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";

export function composerFileInputAccept(
  {
    supportsAttachments,
    attachmentSupport,
  }: Pick<ComposerPolicy, "supportsAttachments" | "attachmentSupport">,
  handoffSelected: boolean,
): string {
  if (!supportsAttachments) return "";
  if (!handoffSelected) return CHAT_ATTACHMENT_ACCEPT;
  return [
    attachmentSupport?.image && CHAT_ATTACHMENT_PICKER_TYPES.image,
    attachmentSupport?.audio && CHAT_ATTACHMENT_PICKER_TYPES.audio,
    attachmentSupport?.video && CHAT_ATTACHMENT_PICKER_TYPES.video,
    attachmentSupport?.pdf && `.pdf,${CHAT_ATTACHMENT_PICKER_TYPES.pdf}`,
  ]
    .filter(Boolean)
    .join(",");
}

const truncateAttachmentDisplayName = (name: string, maxLength = 80): string => {
  if (name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength - 3)}...`;
};

const renderUnsupportedAttachmentDescription = (name: string): ReactElement => {
  return (
    <span>
      <code>{truncateAttachmentDisplayName(name)}</code> is not an image, audio file, video, or PDF.
    </span>
  );
};

/** Makes draft attachments from files. Each file of an unsupported type shows an error toast. */
export const buildComposerAttachmentsFromFiles = (
  files: readonly File[],
): AgentChatComposerAttachment[] =>
  files.flatMap((file) => {
    const attachment = buildComposerAttachmentFromFile(file);
    if (attachment) return [attachment];
    toast.error("Unsupported attachment type", {
      description: renderUnsupportedAttachmentDescription(
        readAttachmentFileName({ name: file.name, mime: file.type }),
      ),
    });
    return [];
  });
