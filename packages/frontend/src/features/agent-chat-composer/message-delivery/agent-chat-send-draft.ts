import type { ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentUserMessagePart } from "@openducktor/core";
import { validateComposerAttachments } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  resolveDraftToUserMessageParts,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { resolveReusablePromptDraftToUserMessageParts } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import type { AttachmentStager } from "@openducktor/frontend-core/platform/device-file";

export type StageAgentChatSendAttachment = (
  attachment: AgentChatComposerAttachment,
) => Promise<string>;

export type AgentChatSendDraftInput = {
  draft: AgentChatComposerDraft;
  reusablePrompts: ReusablePrompt[];
  /** The model that checks the attachments: the turn model for a steer, else the selected one. */
  modelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  supportsAttachments: boolean;
  stageAttachment: StageAgentChatSendAttachment;
};

export type AgentChatSendDraftParts = AgentUserMessagePart[] | Promise<AgentUserMessagePart[]>;

/** Stages a picked device file on the host, or keeps the host path that a draft already has. */
export const createAgentChatSendAttachmentStager =
  (stage: AttachmentStager): StageAgentChatSendAttachment =>
  async (attachment) => {
    if (attachment.file) {
      return stage(attachment.file);
    }
    if (attachment.path) {
      return attachment.path;
    }
    throw new Error(`Attachment "${attachment.name}" is missing local file data.`);
  };

export const resolveAgentChatSendDraftParts = ({
  draft,
  reusablePrompts,
  modelDescriptor,
  supportsAttachments,
  stageAttachment,
}: AgentChatSendDraftInput): AgentChatSendDraftParts | null => {
  const reusablePromptMessageParts = resolveReusablePromptDraftToUserMessageParts(
    draft,
    reusablePrompts,
  );

  if ((draft.attachments ?? []).length > 0) {
    if (!supportsAttachments) {
      return null;
    }
    if (draftHasSlashCommandSegment(draft)) {
      return null;
    }

    const attachmentErrors = validateComposerAttachments(
      draft.attachments ?? [],
      modelDescriptor?.attachmentSupport,
    );
    if (Object.keys(attachmentErrors).length > 0) {
      return null;
    }
  }

  if (!draftHasMeaningfulContent(draft)) {
    return null;
  }

  return (
    reusablePromptMessageParts ??
    resolveDraftToUserMessageParts(draft, async (attachment) => stageAttachment(attachment))
  );
};
