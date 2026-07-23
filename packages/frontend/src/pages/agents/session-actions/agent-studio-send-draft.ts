import type { ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentUserMessagePart } from "@openducktor/core";
import { validateComposerAttachments } from "@/components/features/agents/agent-chat/agent-chat-attachments";
import {
  type AgentChatComposerAttachment,
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  resolveDraftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { resolveReusablePromptDraftToUserMessageParts } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";

export type StageAgentStudioSendAttachment = (
  attachment: AgentChatComposerAttachment,
) => Promise<string>;

type ResolveAgentStudioSendDraftPartsInput = {
  draft: AgentChatComposerDraft;
  reusablePrompts: ReusablePrompt[];
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null | undefined;
  supportsAttachments: boolean;
  stageAttachment?: StageAgentStudioSendAttachment;
};

export type AgentStudioSendDraftParts = AgentUserMessagePart[] | Promise<AgentUserMessagePart[]>;

export const stageAgentStudioSendAttachment = async (
  attachment: AgentChatComposerAttachment,
): Promise<string> => {
  if (attachment.file) {
    return stageLocalAttachmentFile(attachment.file);
  }
  if (attachment.path) {
    return attachment.path;
  }
  throw new Error(`Attachment "${attachment.name}" is missing local file data.`);
};

export const resolveAgentStudioSendDraftParts = ({
  draft,
  reusablePrompts,
  selectedModelDescriptor,
  supportsAttachments,
  stageAttachment = stageAgentStudioSendAttachment,
}: ResolveAgentStudioSendDraftPartsInput): AgentStudioSendDraftParts | null => {
  let reusablePromptMessageParts: AgentUserMessagePart[] | null;
  try {
    reusablePromptMessageParts = resolveReusablePromptDraftToUserMessageParts(
      draft,
      reusablePrompts,
    );
  } catch {
    return null;
  }

  if ((draft.attachments ?? []).length > 0) {
    if (!supportsAttachments) {
      return null;
    }
    if (draftHasSlashCommandSegment(draft)) {
      return null;
    }

    const attachmentErrors = validateComposerAttachments(
      draft.attachments ?? [],
      selectedModelDescriptor?.attachmentSupport,
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
