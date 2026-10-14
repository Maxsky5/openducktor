import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { useMemo } from "react";
import { steerShortcutLabel } from "@/lib/steer-shortcut";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { validateComposerAttachments } from "./agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
} from "./agent-chat-composer-draft";
import { draftSteerBlockedReason, steersRunningTurn } from "./agent-chat-steering";

export function useComposerPolicy({
  model,
  draft,
  primaryMode,
  settingsReady,
}: {
  model: ComposerPolicyModel;
  draft: AgentChatComposerDraft;
  primaryMode: AgentMessageSubmitMode;
  settingsReady: boolean;
}): ComposerPolicy {
  const isSubmitting = composerIsSubmitting(model);
  const isComposerInputDisabled = composerInputDisabledFor(model);
  const defaultAttachmentErrors = useMemo(() => {
    return validateComposerAttachments(
      draft.attachments ?? [],
      model.selectedModelDescriptor?.attachmentSupport,
    );
  }, [draft.attachments, model.selectedModelDescriptor?.attachmentSupport]);
  const steersTurn = steersRunningTurn(primaryMode, model.isSessionWorking);
  const attachmentErrors = useMemo(
    () =>
      steersTurn
        ? validateComposerAttachments(
            draft.attachments ?? [],
            model.runningTurnModel?.attachmentSupport,
            "The model of the running turn",
          )
        : defaultAttachmentErrors,
    [
      draft.attachments,
      model.runningTurnModel?.attachmentSupport,
      steersTurn,
      defaultAttachmentErrors,
    ],
  );
  const hasBlockingAttachments = Object.keys(defaultAttachmentErrors).length > 0;
  const hasSlashAttachmentConflict =
    (draft.attachments ?? []).length > 0 && draftHasSlashCommandSegment(draft);

  const sendInputBlocked =
    isSubmitting ||
    Boolean(model.isSavingModel) ||
    isComposerInputDisabled ||
    model.speed?.pending === true ||
    hasSlashAttachmentConflict ||
    !hasComposerSendContent(draft, model.pendingSendItems);
  const defaultSendDisabled = sendInputBlocked || hasBlockingAttachments;
  const steerBlockedReason = steersTurn ? draftSteerBlockedReason(draft, model) : null;
  const sendBlockedReason = settingsReady
    ? steerBlockedReason
    : "Load chat settings before sending. Use Retry settings if the read failed.";
  const sendDisabled =
    !settingsReady ||
    (steersTurn
      ? sendInputBlocked || steerBlockedReason !== null || Object.keys(attachmentErrors).length > 0
      : defaultSendDisabled);

  return {
    isSubmitting,
    isComposerInputDisabled,
    placeholder: composerPlaceholderFor(model, primaryMode, settingsReady),
    attachmentErrors,
    hasSlashAttachmentConflict,
    sendInputBlocked,
    defaultSendDisabled,
    sendDisabled,
    sendBlockedReason,
  };
}

type ComposerPolicyModel = Pick<
  AgentChatComposerModel,
  | "selectedModelDescriptor"
  | "runningTurnModel"
  | "isSessionWorking"
  | "isSending"
  | "isStarting"
  | "isModelSelectionPending"
  | "isSavingModel"
  | "isInteractionEnabled"
  | "isReadOnly"
  | "isWaitingInput"
  | "isResumingSession"
  | "speed"
  | "pendingSendItems"
  | "steerBlockedReason"
  | "supportsFileSearch"
  | "supportsSubagentReferences"
  | "supportsSlashCommands"
  | "supportsSkillReferences"
  | "readOnlyReason"
  | "waitingInputPlaceholder"
  | "messageQueue"
>;

type ComposerPolicy = {
  isSubmitting: boolean;
  isComposerInputDisabled: boolean;
  placeholder: string;
  attachmentErrors: Record<string, string>;
  hasSlashAttachmentConflict: boolean;
  sendInputBlocked: boolean;
  defaultSendDisabled: boolean;
  sendDisabled: boolean;
  sendBlockedReason: string | null;
};

const composerPlaceholderFor = (
  model: ComposerPolicyModel,
  primaryMode: AgentMessageSubmitMode,
  settingsReady: boolean,
): string => {
  const {
    supportsFileSearch,
    supportsSubagentReferences,
    supportsSlashCommands,
    supportsSkillReferences,
    isReadOnly,
    readOnlyReason,
    isWaitingInput,
    waitingInputPlaceholder,
  } = model;
  if (isWaitingInput) {
    return waitingInputPlaceholder ?? "Resolve the pending request above to continue";
  }
  if (isReadOnly && readOnlyReason) return readOnlyReason;
  if (!settingsReady) return "Load chat settings before sending";

  let referenceHint: string | null = null;
  if (supportsFileSearch && supportsSubagentReferences) {
    referenceHint = "@ for files and subagents";
  } else if (supportsSubagentReferences) {
    referenceHint = "@ for subagents";
  } else if (supportsFileSearch) {
    referenceHint = "@ for files";
  }
  const hints = [
    referenceHint,
    supportsSlashCommands ? "/ for commands" : null,
    supportsSkillReferences ? "$ for skills" : null,
    ...queuePlaceholderParts(model, primaryMode),
  ].filter((part): part is string => Boolean(part));
  return hints.length > 0 ? hints.join("; ") : "Type a message";
};

const queuePlaceholderParts = (
  { isSessionWorking, messageQueue, steerBlockedReason }: ComposerPolicyModel,
  primaryMode: AgentMessageSubmitMode,
): string[] => {
  const queueKey = primaryMode === "default" ? "Enter" : steerShortcutLabel();
  const steerKey = primaryMode === "steer" ? "Enter" : steerShortcutLabel();
  if (isSessionWorking && steerBlockedReason) return [`${queueKey} to queue`];
  const hasQueuedMessages = (messageQueue?.queue?.entries.length ?? 0) > 0;
  if (!isSessionWorking && !hasQueuedMessages) return [];
  const steerAction = isSessionWorking ? "steer" : "send now";
  if (primaryMode === "steer") {
    return [`${steerKey} to ${steerAction}`, `${queueKey} to queue`];
  }
  return [`${queueKey} to queue`, `${steerKey} to ${steerAction}`];
};

const hasComposerSendContent = (
  draft: AgentChatComposerDraft,
  pendingSendItems: ComposerPolicyModel["pendingSendItems"],
): boolean => {
  return draftHasMeaningfulContent(draft) || (pendingSendItems?.count ?? 0) > 0;
};

const composerInputDisabledFor = ({
  isInteractionEnabled,
  isReadOnly,
  isModelSelectionPending,
  isWaitingInput,
  isResumingSession,
}: ComposerPolicyModel): boolean => {
  return (
    !isInteractionEnabled ||
    isReadOnly ||
    isModelSelectionPending ||
    isWaitingInput ||
    isResumingSession
  );
};

const composerIsSubmitting = ({
  isSending,
  isSessionWorking,
  isStarting,
  isModelSelectionPending,
}: ComposerPolicyModel): boolean =>
  (isSending && !isSessionWorking) || isStarting || isModelSelectionPending;
