import type { ReactElement } from "react";
import { toast } from "sonner";
import { readAttachmentFileName } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import { buildComposerAttachmentFromFile } from "./agent-chat-attachment-files";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";

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
