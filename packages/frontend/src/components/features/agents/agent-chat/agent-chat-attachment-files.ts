import { buildComposerAttachmentFromDeviceFile } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";

/** A browser sends the file name with the bytes, so a renamed attachment needs a renamed file. */
const renameFile = (file: File, name: string): File =>
  new File([file], name, { type: file.type, lastModified: file.lastModified });

/** Builds a composer attachment from a file that the user picked in this browser. */
export const buildComposerAttachmentFromFile = (file: File): AgentChatComposerAttachment | null =>
  buildComposerAttachmentFromDeviceFile(file, renameFile);
