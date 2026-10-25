import { LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type { AgentAttachmentKind, AgentModelAttachmentSupport } from "@openducktor/core";
import {
  buildComposerAttachmentFromDeviceFile,
  readAttachmentFileName,
} from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import type { IconName } from "@/ui/icon";

/** The desktop icon of each Attachment kind, for a picked file and a sent attachment. */
export const ATTACHMENT_KIND_ICONS = {
  image: "image",
  audio: "file-audio-2",
  video: "film",
  pdf: "file-text",
} as const satisfies Record<AgentAttachmentKind, IconName>;

const KIND_PICKER_TYPES = {
  image: "image/*",
  audio: "audio/*",
  video: "video/*",
  pdf: "application/pdf",
} satisfies Record<AgentAttachmentKind, string>;

const KIND_NAMES = {
  image: "images",
  audio: "audio files",
  video: "videos",
  pdf: "PDFs",
} satisfies Record<AgentAttachmentKind, string>;

const ATTACHMENT_KINDS: readonly AgentAttachmentKind[] = ["image", "audio", "video", "pdf"];

/** The pickers that the composer offers for the selected model. */
export type AttachmentPickers = {
  /** The photo library. It needs image support. */
  library: boolean;
  /** The media types that the file picker allows. Empty when the model takes no file. */
  documentTypes: string[];
  /** The kinds that the model takes, for the picker labels. */
  kinds: AgentAttachmentKind[];
  /** Why the composer offers no attachment, or null when it offers one. */
  unavailableReason: string | null;
};

/**
 * Offers only the Attachment kinds that the selected model supports. A runtime without
 * attachments, or a model without capability data, offers none and says why.
 */
export const resolveAttachmentPickers = ({
  runtimeSupportsAttachments,
  support,
}: {
  runtimeSupportsAttachments: boolean;
  support: AgentModelAttachmentSupport | null | undefined;
}): AttachmentPickers => {
  if (!runtimeSupportsAttachments) {
    return {
      library: false,
      documentTypes: [],
      kinds: [],
      unavailableReason: "The runtime of this session takes no attachments.",
    };
  }
  if (!support) {
    return {
      library: false,
      documentTypes: [],
      kinds: [],
      unavailableReason: "The selected model does not say which attachments it takes.",
    };
  }
  const kinds = ATTACHMENT_KINDS.filter((kind) => support[kind]);
  return {
    library: support.image,
    documentTypes: kinds.map((kind) => KIND_PICKER_TYPES[kind]),
    kinds,
    unavailableReason: kinds.length === 0 ? "The selected model takes no attachments." : null,
  };
};

/** The words that name the attachment kinds of the model, such as "images and PDFs". */
export const attachmentKindsText = (kinds: readonly AgentAttachmentKind[]): string => {
  const names = kinds.map((kind) => KIND_NAMES[kind]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

type RejectedAttachment = { name: string; reason: string };

/** The picked files that a draft takes, and the files that stay out with their reason. */
export type PickedFilesIntake = {
  attachments: AgentChatComposerAttachment[];
  rejected: RejectedAttachment[];
};

const LIMIT_MIB = Math.round(LOCAL_ATTACHMENT_BYTE_LIMIT / (1024 * 1024));

/**
 * Turns picked files into draft attachments. A file of another type, or a file over the host
 * size limit, stays out with its reason. The model checks of the composer policy still apply.
 */
export const intakePickedFiles = (files: readonly DeviceFileReference[]): PickedFilesIntake => {
  const attachments: AgentChatComposerAttachment[] = [];
  const rejected: RejectedAttachment[] = [];
  for (const file of files) {
    const name = readAttachmentFileName({ name: file.name, mime: file.type });
    if (file.size > LOCAL_ATTACHMENT_BYTE_LIMIT) {
      rejected.push({
        name,
        reason: `${name} is larger than ${LIMIT_MIB} MiB, the host limit for attachments.`,
      });
      continue;
    }
    const attachment = buildComposerAttachmentFromDeviceFile(file);
    if (attachment) {
      attachments.push(attachment);
      continue;
    }
    rejected.push({ name, reason: `${name} is not an image, audio file, video, or PDF.` });
  }
  return { attachments, rejected };
};
