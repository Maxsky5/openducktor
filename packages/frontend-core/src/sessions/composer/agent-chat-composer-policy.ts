import type { AgentMessageSubmitMode, AgentSessionGoalStatus } from "@openducktor/contracts";
import type { AgentModelAttachmentSupport, AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import { validateComposerAttachments } from "../../drafts/agent-chat-attachments";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
} from "../../drafts/agent-chat-composer-draft";
import { blockedSpeedReason } from "../model-selection/model-picker-presentation";
import type { SpeedControlModel } from "../model-selection/use-speed-control";
import {
  draftSteerBlockedReason,
  hasForegroundTurn,
  hasOngoingWork,
  steersRunningTurn,
} from "../send/agent-chat-steering";
import type {
  AgentChatMessageQueueModel,
  AgentChatPendingSendGroup,
} from "../send/agent-chat.types";
import type { HandoffSelection } from "../send/runtime-handoff";
import { hasPendingSendItems, readPendingSendBlockedReason } from "./agent-chat-pending-send";

/** The chat state that decides what the composer allows. */
export type ComposerPolicyModel = {
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null | undefined;
  runningTurnModel: AgentModelCatalog["models"][number] | null;
  isSessionWorking: boolean;
  /** True while the session runs a turn in the foreground. */
  foregroundTurnActive?: boolean | undefined;
  isSending: boolean;
  isStarting: boolean;
  isInteractionEnabled: boolean;
  isReadOnly: boolean;
  canSend?: boolean | undefined;
  isWaitingInput: boolean;
  isResumingSession: boolean;
  speed: SpeedControlModel | null;
  pendingSendItems?: readonly AgentChatPendingSendGroup[] | undefined;
  supportsAttachments: boolean;
  /** Why the session cannot steer the running turn now, or null when it can. */
  steerBlockedReason: string | null;
  supportsFileSearch: boolean;
  supportsSubagentReferences: boolean;
  supportsSlashCommands: boolean;
  supportsSkillReferences: boolean;
  readOnlyReason: string | null;
  waitingInputPlaceholder?: string | null | undefined;
  messageQueue: AgentChatMessageQueueModel | null;
  /** The goal of the session, or null when it has none. */
  goalRow?: { readonly status: AgentSessionGoalStatus } | null | undefined;
};

export type ComposerPolicy = {
  isSubmitting: boolean;
  isComposerInputDisabled: boolean;
  placeholder: string;
  /**
   * The trigger and key hints that the placeholder lists, or null while the placeholder tells
   * the state of the chat, such as a pending request. Empty when the chat offers no hint.
   */
  placeholderHints: readonly string[] | null;
  supportsAttachments: boolean;
  attachmentSupport: AgentModelAttachmentSupport | undefined;
  attachmentErrors: Record<string, string>;
  hasSlashAttachmentConflict: boolean;
  sendInputBlocked: boolean;
  defaultSendDisabled: boolean;
  sendDisabled: boolean;
  sendBlockedReason: string | null;
  /** Why the pending items, such as review comments or annotations, block Send, or null. */
  pendingSendBlockedReason: string | null;
};

export type ComposerPolicyInput = {
  model: ComposerPolicyModel;
  handoffSelection?: Pick<HandoffSelection, "descriptor" | "supportsAttachments"> | undefined;
  draft: AgentChatComposerDraft;
  primaryMode: AgentMessageSubmitMode;
  settingsReady: boolean;
  /**
   * The key label that steers, such as "⌘ Enter". The placeholder then names the keys that queue
   * and steer. Null leaves the key hints out, for a client without that shortcut.
   */
  steerShortcutLabel: string | null;
};

const deriveComposerPolicy = ({
  model,
  draft,
  primaryMode,
  settingsReady,
  steerShortcutLabel,
  supportsAttachments,
  attachmentSupport,
  attachmentErrors,
  hasBlockingAttachments,
  hasSlashAttachmentConflict,
  pendingSendBlockedReason,
  steersTurn,
}: ComposerPolicyInput &
  ReturnType<typeof useAttachmentPolicy> & { steersTurn: boolean }): ComposerPolicy => {
  const isSubmitting = composerIsSubmitting(model);
  const isComposerInputDisabled = composerInputDisabledFor(model);
  const speedBlockedReason = blockedSpeedReason(model.speed);
  const turnSpeedBlockedReason = steersTurn ? null : speedBlockedReason;

  const sendInputBlocked =
    model.canSend === false ||
    isSubmitting ||
    isComposerInputDisabled ||
    hasSlashAttachmentConflict ||
    pendingSendBlockedReason !== null ||
    !hasComposerSendContent(draft, model.pendingSendItems);
  const defaultSendDisabled =
    sendInputBlocked || hasBlockingAttachments || speedBlockedReason !== null;
  const steerBlockedReason = steersTurn ? draftSteerBlockedReason(draft, model) : null;
  const sendBlockedReason = !settingsReady
    ? "Load session settings before sending. Use Retry settings if the read failed."
    : (steerBlockedReason ?? turnSpeedBlockedReason);
  const sendDisabled =
    !settingsReady ||
    sendInputBlocked ||
    steerBlockedReason !== null ||
    turnSpeedBlockedReason !== null ||
    Object.keys(attachmentErrors).length > 0;
  const placeholder = composerPlaceholderFor(model, primaryMode, settingsReady, steerShortcutLabel);

  return {
    isSubmitting,
    isComposerInputDisabled,
    placeholder: placeholder.text,
    placeholderHints: placeholder.hints,
    supportsAttachments,
    attachmentSupport,
    attachmentErrors,
    hasSlashAttachmentConflict,
    sendInputBlocked,
    defaultSendDisabled,
    sendDisabled,
    sendBlockedReason,
    pendingSendBlockedReason,
  };
};

/** Decides the placeholder and which composer actions are open for the draft. */
export function useComposerPolicy({
  model,
  handoffSelection,
  draft,
  primaryMode,
  settingsReady,
  steerShortcutLabel,
}: ComposerPolicyInput): ComposerPolicy {
  const steersTurn = !handoffSelection && steersRunningTurn(primaryMode, hasForegroundTurn(model));
  const attachmentPolicy = useAttachmentPolicy(model, draft, steersTurn, handoffSelection);
  return deriveComposerPolicy({
    model,
    draft,
    primaryMode,
    settingsReady,
    steerShortcutLabel,
    ...attachmentPolicy,
    steersTurn,
  });
}

function useAttachmentPolicy(
  model: ComposerPolicyModel,
  draft: AgentChatComposerDraft,
  steersTurn: boolean,
  handoffSelection: ComposerPolicyInput["handoffSelection"],
) {
  const supportsAttachments = handoffSelection?.supportsAttachments ?? model.supportsAttachments;
  const attachmentSupport = (handoffSelection?.descriptor ?? model.selectedModelDescriptor)
    ?.attachmentSupport;
  const defaultAttachmentErrors = useMemo(
    () => validateComposerAttachments(draft.attachments ?? [], attachmentSupport),
    [draft.attachments, attachmentSupport],
  );
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
  const pendingSendBlockedReason = readPendingSendBlockedReason({
    groups: model.pendingSendItems,
    draft,
    supportsAttachments,
    attachmentSupport: steersTurn ? model.runningTurnModel?.attachmentSupport : attachmentSupport,
  });
  return {
    supportsAttachments,
    attachmentSupport,
    attachmentErrors,
    hasBlockingAttachments,
    hasSlashAttachmentConflict,
    pendingSendBlockedReason,
  };
}

/** The placeholder text, and the hints that it lists, or null for a state message. */
type ComposerPlaceholder = { text: string; hints: string[] | null };

const composerPlaceholderFor = (
  model: ComposerPolicyModel,
  primaryMode: AgentMessageSubmitMode,
  settingsReady: boolean,
  steerShortcutLabel: string | null,
): ComposerPlaceholder => {
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
    return {
      text: waitingInputPlaceholder ?? "Resolve the pending request above to continue",
      hints: null,
    };
  }
  if (isReadOnly && readOnlyReason) return { text: readOnlyReason, hints: null };
  if (!settingsReady) return { text: "Load session settings before sending", hints: null };

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
    ...(steerShortcutLabel === null
      ? []
      : queuePlaceholderParts(model, primaryMode, steerShortcutLabel)),
  ].filter((part): part is string => Boolean(part));
  return { text: hints.length > 0 ? hints.join("; ") : "Type a message", hints };
};

const queuePlaceholderParts = (
  model: ComposerPolicyModel,
  primaryMode: AgentMessageSubmitMode,
  steerShortcutLabel: string,
): string[] => {
  const queueKey = primaryMode === "default" ? "Enter" : steerShortcutLabel;
  const steerKey = primaryMode === "steer" ? "Enter" : steerShortcutLabel;
  const turnActive = hasOngoingWork(model);
  if (turnActive && model.steerBlockedReason) return [`${queueKey} to queue`];
  const hasQueuedMessages = (model.messageQueue?.queue?.entries.length ?? 0) > 0;
  if (!turnActive && !hasQueuedMessages) return [];
  const steerAction = turnActive ? "steer" : "send now";
  if (primaryMode === "steer") {
    return [`${steerKey} to ${steerAction}`, `${queueKey} to queue`];
  }
  return [`${queueKey} to queue`, `${steerKey} to ${steerAction}`];
};

const hasComposerSendContent = (
  draft: AgentChatComposerDraft,
  pendingSendItems: ComposerPolicyModel["pendingSendItems"],
): boolean => {
  return draftHasMeaningfulContent(draft) || hasPendingSendItems(pendingSendItems);
};

const composerInputDisabledFor = ({
  isInteractionEnabled,
  isReadOnly,
  isWaitingInput,
  isResumingSession,
}: ComposerPolicyModel): boolean => {
  return !isInteractionEnabled || isReadOnly || isWaitingInput || isResumingSession;
};

const composerIsSubmitting = (model: ComposerPolicyModel): boolean =>
  (model.isSending && !hasForegroundTurn(model)) || model.isStarting;
