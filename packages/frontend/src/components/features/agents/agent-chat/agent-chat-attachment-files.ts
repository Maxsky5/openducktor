import type { AgentAttachmentKind } from "@openducktor/core";
import {
  classifyAttachment,
  inferAttachmentMime,
  readAttachmentFileName,
} from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import {
  type AgentChatComposerAttachment,
  createComposerAttachment,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";

const normalizeAttachmentFile = (file: File, kind: AgentAttachmentKind): File => {
  const normalizedName = readAttachmentFileName({
    name: file.name,
    mime: file.type,
    kind,
  });
  if (normalizedName === file.name) {
    return file;
  }

  return new File([file], normalizedName, {
    type: file.type,
    lastModified: file.lastModified,
  });
};

/** Builds a composer attachment from a file that the user picked in this browser. */
export const buildComposerAttachmentFromFile = (file: File): AgentChatComposerAttachment | null => {
  const kind = classifyAttachment({ name: file.name, mime: file.type });
  if (!kind) {
    return null;
  }
  const normalizedFile = normalizeAttachmentFile(file, kind);
  const mime = inferAttachmentMime(normalizedFile.name, normalizedFile.type);

  const attachment: Parameters<typeof createComposerAttachment>[0] = {
    name: normalizedFile.name,
    kind,
    file: normalizedFile,
  };
  if (mime) {
    attachment.mime = mime;
  }
  return createComposerAttachment(attachment);
};
