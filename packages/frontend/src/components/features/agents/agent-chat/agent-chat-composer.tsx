import {
  ShortcutScope,
  ShortcutButton,
  useShortcutTitle,
} from "@/features/shortcuts/shortcut-controls";

import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import { useCommandPalettePageCommands } from "@/features/command-palette/command-palette-context";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { Paperclip, Square } from "lucide-react";
import {
  memo,
  type ReactElement,
  type Ref,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { toast } from "sonner";
import { ModelPicker } from "@/components/features/agents/model-picker";
import { BorderRay } from "@/components/ui/border-ray";
import { cn } from "@/lib/utils";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { AgentChatGoalRow } from "./agent-chat-goal-row";
import { AgentChatBackgroundTaskBar } from "./agent-chat-background-task-bar";
import {
  buildComposerAttachmentsFromFiles,
  composerFileInputAccept,
} from "./agent-chat-attachment-intake";
import {
  createComposerAutofocusState,
  resolveComposerAutofocus,
} from "./agent-chat-composer-autofocus";
import {
  type AgentChatComposerDraft,
  appendAttachmentsToDraft,
  removeAttachmentFromDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  AgentChatComposerEditor,
  type AgentChatComposerEditorCatalog,
} from "./agent-chat-composer-editor";
import {
  AgentChatMessageQueue,
  AgentChatMessageQueuePauseNotice,
} from "./agent-chat-message-queue";
import {
  ACTIVE_COMPOSER_CARD_CLASS_NAME,
  COMPOSER_CARD_CLASS_NAME,
  COMPOSER_QUIET_CONTROL_CLASS_NAME,
} from "./agent-chat-composer-surface";
import { focusEditorEnd } from "./agent-chat-composer-selection";
import {
  AgentChatComposerPendingNotices,
  AgentChatComposerSendControl,
} from "./agent-chat-composer-pending-items";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";
import { useAgentChatComposerDraftState } from "@openducktor/frontend-core/sessions/composer/use-agent-chat-composer-draft-state";
import { documentVisibility } from "@/features/session-navigation/document-visibility";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { useComposerPolicy } from "@openducktor/frontend-core/sessions/composer/agent-chat-composer-policy";
import { useAgentChatComposerSubmit } from "@openducktor/frontend-core/sessions/composer/use-agent-chat-composer-submit";
import type { ComposerFailure } from "@openducktor/frontend-core/sessions/composer/composer-failure";
import { steerShortcutLabel } from "@/lib/steer-shortcut";
import { Button } from "@/components/ui/button";

const MemoizedAgentChatComposerEditor = memo(AgentChatComposerEditor);

export type AgentChatComposerHandle = {
  addFiles: (files: File[]) => void;
};

const resolveModelPickerReadOnlyReason = ({
  isReadOnly,
  readOnlyReason,
  isSubmitting,
  isInteractionEnabled,
  isRuntimeLocked,
}: {
  isReadOnly: boolean;
  readOnlyReason: string | null | undefined;
  isSubmitting: boolean;
  isInteractionEnabled: boolean;
  isRuntimeLocked: boolean;
}): string | null => {
  if (isReadOnly) {
    return readOnlyReason ?? "Model selection is unavailable right now.";
  }
  if (isSubmitting) {
    return "Wait for the current submission to finish.";
  }
  if (!isInteractionEnabled && isRuntimeLocked) {
    return "Model selection is unavailable right now.";
  }
  return null;
};

export function AgentChatComposer({
  model,
  ref,
}: {
  model: AgentChatComposerModel;
  ref?: Ref<AgentChatComposerHandle>;
}): ReactElement {
  const chatSettings = useAgentChatSettings();
  const settingsReady = chatSettings !== null;
  const primaryMode: AgentMessageSubmitMode = chatSettings?.steerMessagesByDefault
    ? "steer"
    : "default";
  const {
    displayedSessionKey,
    isInteractionEnabled,
    isReadOnly,
    draftScope,
    accentColor: composerAccentColor,
    composerEditorRef,
    onComposerEditorInput,
  } = model;

  const {
    draft,
    commitDraft,
    setDisplayedDraft,
    createSubmittedDraftSnapshot,
    clearSubmittedDraft,
    restoreSubmittedDraft,
  } = useAgentChatComposerDraftState({
    scope: draftScope,
    visibility: documentVisibility,
  });
  const draftRef = useRef<AgentChatComposerDraft>(draft);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const handoffSelection = model.handoff?.selection;
  const policy = useComposerPolicy({
    model,
    handoffSelection,
    draft,
    primaryMode,
    settingsReady,
    steerShortcutLabel: steerShortcutLabel(),
  });
  const {
    isSubmitting,
    isComposerInputDisabled,
    placeholder,
    attachmentErrors,
    hasSlashAttachmentConflict,
    sendInputBlocked,
    defaultSendDisabled,
    sendDisabled,
    sendBlockedReason,
    pendingSendBlockedReason,
  } = policy;
  // A send clears the draft at once, so the user can write the next message while it runs.
  const attachmentAccept = composerFileInputAccept(policy, handoffSelection !== undefined);
  const attachmentIntakeDisabled = !attachmentAccept || isComposerInputDisabled;

  const handleDraftChange = useCallback(
    (nextDraft: AgentChatComposerDraft) => {
      draftRef.current = nextDraft;
      commitDraft(nextDraft);
    },
    [commitDraft],
  );

  const handleRemoveAttachment = useCallback(
    (attachmentId: string): void => {
      handleDraftChange(removeAttachmentFromDraft(draftRef.current, attachmentId));
      onComposerEditorInput();
    },
    [handleDraftChange, onComposerEditorInput],
  );

  const handleAddFiles = useCallback(
    (files: File[]): void => {
      if (attachmentIntakeDisabled) {
        return;
      }

      const attachments = buildComposerAttachmentsFromFiles(files);
      if (attachments.length === 0) {
        return;
      }
      handleDraftChange(appendAttachmentsToDraft(draftRef.current, attachments));
      onComposerEditorInput();
    },
    [attachmentIntakeDisabled, handleDraftChange, onComposerEditorInput],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles: handleAddFiles,
    }),
    [handleAddFiles],
  );

  const openAttachmentPicker = useCallback((): void => {
    if (attachmentIntakeDisabled) {
      return;
    }
    attachmentInputRef.current?.click();
  }, [attachmentIntakeDisabled]);

  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const hardModelPickerReadOnlyReason = model.handoff?.blocked
    ? "Resolve the pending handoff before changing the model."
    : resolveModelPickerReadOnlyReason({
        isReadOnly,
        readOnlyReason: model.readOnlyReason,
        isSubmitting,
        isInteractionEnabled,
        isRuntimeLocked: model.modelPicker.selectionPolicy.kind === "runtime_locked",
      });
  const closedModelPickerDisabledReason = null;

  const scheduleComposerFocus = useAgentChatComposerFocus({
    composerEditorRef,
    displayedSessionKey,
    isComposerInputDisabled,
  });

  const reportSendError = useCallback((failure: ComposerFailure): void => {
    toast.error(failure.title, { description: failure.message });
  }, []);
  const handleSubmit = useAgentChatComposerSubmit({
    model,
    draftState: {
      createSubmittedDraftSnapshot,
      clearSubmittedDraft,
      restoreSubmittedDraft,
      setDisplayedDraft,
    },
    draftRef,
    settingsReady,
    sendInputBlocked,
    defaultSendDisabled,
    reportError: reportSendError,
    onDraftReplaced: onComposerEditorInput,
    onSettledInScope: scheduleComposerFocus,
  });
  const submitComposerAction = useCallback((): void => {
    void handleSubmit(primaryMode);
  }, [handleSubmit, primaryMode]);
  const shortcutActive = useSessionViewActive();
  useCommandPalettePageCommands(
    shortcutActive
      ? [
          {
            id: "session-send" as const,
            keywords: ["submit", "send"],
            target: { kind: "session", key: model.displayedSessionKey ?? "draft" },
            disabledReason: () =>
              sendDisabled ? (sendBlockedReason ?? "Sending is unavailable.") : null,
            run: submitComposerAction,
          },
          {
            id: "session-stop" as const,
            keywords: ["stop", "interrupt"],
            target: { kind: "session", key: model.displayedSessionKey ?? "draft" },
            disabledReason: () => (model.canStopSession ? null : "No run can be stopped."),
            run: model.onStopSession,
          },
          {
            id: "session-attach" as const,
            keywords: ["files", "attachment"],
            target: { kind: "session", key: model.displayedSessionKey ?? "draft" },
            disabledReason: () =>
              attachmentIntakeDisabled ? "Attachments are unavailable." : null,
            run: openAttachmentPicker,
          },
        ]
      : [],
  );
  return (
    <AgentChatComposerFormView
      primaryMode={primaryMode}
      sendBlockedReason={sendBlockedReason}
      model={model}
      draft={draft}
      attachmentInputRef={attachmentInputRef}
      attachmentAccept={attachmentAccept}
      attachmentErrors={attachmentErrors}
      attachmentIntakeDisabled={attachmentIntakeDisabled}
      composerAccentColor={composerAccentColor}
      composerPlaceholder={placeholder}
      hasSlashAttachmentConflict={hasSlashAttachmentConflict}
      isComposerInputDisabled={isComposerInputDisabled}
      isSubmitting={isSubmitting}
      pendingSendBlockedReason={pendingSendBlockedReason}
      hardModelPickerReadOnlyReason={hardModelPickerReadOnlyReason}
      closedModelPickerDisabledReason={closedModelPickerDisabledReason}
      sendDisabled={sendDisabled}
      onAddFiles={handleAddFiles}
      onDraftChange={handleDraftChange}
      onPickAttachments={openAttachmentPicker}
      onRemoveAttachment={handleRemoveAttachment}
      onSend={handleSubmit}
      submitAction={submitComposerAction}
    />
  );
}

type AgentChatComposerFormViewProps = {
  primaryMode: AgentMessageSubmitMode;
  sendBlockedReason: string | null;
  model: AgentChatComposerModel;
  draft: AgentChatComposerDraft;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  attachmentAccept: string;
  attachmentErrors: Record<string, string>;
  attachmentIntakeDisabled: boolean;
  composerAccentColor: string | undefined;
  composerPlaceholder: string;
  hasSlashAttachmentConflict: boolean;
  isComposerInputDisabled: boolean;
  isSubmitting: boolean;
  pendingSendBlockedReason: string | null;
  hardModelPickerReadOnlyReason: string | null;
  closedModelPickerDisabledReason: string | null;
  sendDisabled: boolean;
  onAddFiles: (files: File[]) => void;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: (mode: AgentMessageSubmitMode) => Promise<void>;
  submitAction: () => void;
};

// The selectors shrink and truncate their labels in a narrow pane. They have no border, so focus
// shows as a ring.
const COMPOSER_SELECTOR_TRIGGER_CLASS_NAME = cn(
  COMPOSER_QUIET_CONTROL_CLASS_NAME,
  "!h-7 !w-auto shrink !rounded-lg !border-transparent !bg-transparent text-xs hover:!bg-muted focus-visible:ring-2 data-[state=open]:!bg-muted",
);

const AgentChatComposerControls = memo(function AgentChatComposerControls({
  speed,
  onPickAttachments,
  attachmentIntakeDisabled,
  selectedModelSelection,
  agentOptions,
  modelPicker,
  variantOptions,
  isSelectionCatalogLoading,
  hardModelPickerReadOnlyReason,
  closedModelPickerDisabledReason,
  onSelectAgent,
  onSelectVariant,
  contextUsage,
  canStopSession,
  onStopSession,
  showSubmittingState,
  sendDisabled,
  pendingSendItems,
}: {
  speed: AgentChatComposerModel["speed"];
  onPickAttachments: () => void;
  attachmentIntakeDisabled: boolean;
  selectedModelSelection: AgentChatComposerModel["selectedModelSelection"];
  agentOptions: AgentChatComposerModel["agentOptions"];
  modelPicker: AgentChatComposerModel["modelPicker"];
  variantOptions: AgentChatComposerModel["variantOptions"];
  isSelectionCatalogLoading: boolean;
  hardModelPickerReadOnlyReason: string | null;
  closedModelPickerDisabledReason: string | null;
  onSelectAgent: AgentChatComposerModel["onSelectAgent"];
  onSelectVariant: AgentChatComposerModel["onSelectVariant"];
  contextUsage: AgentChatComposerModel["contextUsage"];
  canStopSession: boolean;
  onStopSession: AgentChatComposerModel["onStopSession"];
  showSubmittingState: boolean;
  sendDisabled: boolean;
  pendingSendItems: AgentChatComposerModel["pendingSendItems"];
}): ReactElement {
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const shortcutDisabledReason = hardModelPickerReadOnlyReason ?? closedModelPickerDisabledReason;
  const shortcutOwner = useLocalShortcuts(
    modelTrigger,
    [
      {
        id: "session-model" as const,
        run: () => modelTrigger.current?.click(),
        disabledReason: shortcutDisabledReason,
      },
    ],
    "form",
  );

  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <div className="flex flex-wrap items-end gap-2 px-2 pb-2 pt-1">
        <div className="flex min-w-0 flex-auto flex-wrap items-center gap-1">
          <ShortcutButton
            shortcutId="session-attach"
            type="button"
            size="icon"
            variant="ghost"
            className={cn("size-7 rounded-lg hover:bg-muted", COMPOSER_QUIET_CONTROL_CLASS_NAME)}
            aria-label="Add attachment"
            disabled={attachmentIntakeDisabled}
            onClick={onPickAttachments}
          >
            <Paperclip className="size-3.5" />
          </ShortcutButton>

          <ModelPicker
            triggerVariant="composer"
            shortcutId="session-model"
            triggerRef={modelTrigger}
            popoverSide="top"
            popoverAvoidCollisions={false}
            runtimes={modelPicker.runtimes}
            value={modelPicker.value}
            favoriteState={modelPicker.favoriteState}
            selectionPolicy={
              hardModelPickerReadOnlyReason
                ? { kind: "read_only", reason: hardModelPickerReadOnlyReason }
                : modelPicker.selectionPolicy
            }
            closedTriggerDisabledReason={closedModelPickerDisabledReason}
            options={{
              effort: {
                options: variantOptions,
                value: selectedModelSelection?.variant,
                onSelect: onSelectVariant,
              },
              profile: {
                options: agentOptions,
                value: selectedModelSelection?.profileId,
                onSelect: onSelectAgent,
              },
              speed: {
                control: speed
                  ? { ...speed, disabled: speed.disabled || hardModelPickerReadOnlyReason !== null }
                  : null,
              },
            }}
            placeholder={isSelectionCatalogLoading ? "Loading models..." : "Model"}
            triggerClassName={cn(
              COMPOSER_SELECTOR_TRIGGER_CLASS_NAME,
              "max-w-[min(26rem,100%)] !px-2",
            )}
            onValueChange={modelPicker.onValueChange}
            onOpenChange={modelPicker.onOpenChange}
          />
        </div>

        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {contextUsage ? (
            <AgentContextUsageIndicator
              className="min-w-0"
              totalTokens={contextUsage.totalTokens}
              contextWindow={contextUsage.contextWindow}
              {...(contextUsage.outputLimit !== undefined
                ? { outputLimit: contextUsage.outputLimit }
                : {})}
            />
          ) : null}
          <div className="flex shrink-0 items-center gap-1.5">
            {canStopSession ? (
              <ShortcutButton
                shortcutId="session-stop"
                type="button"
                size="icon"
                variant="destructive"
                className="size-8 rounded-lg"
                aria-label="Stop session"
                onClick={onStopSession}
              >
                <Square className="size-3 fill-current" />
              </ShortcutButton>
            ) : null}
            <AgentChatComposerSendControl
              sendDisabled={sendDisabled}
              showSubmittingState={showSubmittingState}
              pendingSendItems={pendingSendItems}
            />
          </div>
        </div>
      </div>
    </ShortcutScope>
  );
});

function AgentChatComposerAttachments({
  draft,
  attachmentErrors,
  hasSlashAttachmentConflict,
  onRemoveAttachment,
}: Pick<
  AgentChatComposerFormViewProps,
  "draft" | "attachmentErrors" | "hasSlashAttachmentConflict" | "onRemoveAttachment"
>): ReactElement | null {
  const attachments = draft.attachments ?? [];
  if (attachments.length === 0) return null;
  return (
    <section className="px-3 pt-3">
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <AgentChatAttachmentChip
            key={attachment.id}
            variant="draft"
            attachment={attachment}
            error={attachmentErrors[attachment.id] ?? null}
            onRemove={() => onRemoveAttachment(attachment.id)}
          />
        ))}
      </div>
      {hasSlashAttachmentConflict ? (
        <p className="mt-2 text-xs text-destructive">
          Remove attachments before running a slash command.
        </p>
      ) : null}
    </section>
  );
}

const composerCardClassName = ({
  isWaitingInput,
  isInputMuted,
}: {
  isWaitingInput: boolean;
  isInputMuted: boolean;
}): string => {
  if (isWaitingInput) {
    return cn(COMPOSER_CARD_CLASS_NAME, "odt-waiting-input-card bg-chat-surface");
  }
  if (isInputMuted) {
    return cn(COMPOSER_CARD_CLASS_NAME, "bg-chat-surface/60");
  }
  return ACTIVE_COMPOSER_CARD_CLASS_NAME;
};

function HandoffNotice({
  notice,
}: {
  notice: NonNullable<AgentChatComposerModel["handoff"]>["notice"] | undefined;
}): ReactElement | null {
  if (!notice) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm">
      <div role="status" className="min-w-0">
        <p className="font-medium">{notice.title}</p>
        <p className="text-muted-foreground">{notice.details}</p>
      </div>
      {notice.check ? (
        <Button type="button" size="sm" variant="outline" onClick={notice.check}>
          Check delivery
        </Button>
      ) : notice.cancel ? (
        <Button type="button" size="sm" variant="ghost" onClick={notice.cancel}>
          Cancel handoff
        </Button>
      ) : null}
    </div>
  );
}

function AgentChatComposerFormView({
  primaryMode,
  sendBlockedReason,
  model,
  draft,
  attachmentInputRef,
  attachmentAccept,
  attachmentErrors,
  attachmentIntakeDisabled,
  composerAccentColor,
  composerPlaceholder,
  hasSlashAttachmentConflict,
  isComposerInputDisabled,
  isSubmitting,
  pendingSendBlockedReason,
  hardModelPickerReadOnlyReason,
  closedModelPickerDisabledReason,
  sendDisabled,
  onAddFiles,
  onDraftChange,
  onPickAttachments,
  onRemoveAttachment,
  onSend,
  submitAction,
}: AgentChatComposerFormViewProps): ReactElement {
  const {
    pendingSendItems,
    isSessionWorking,
    isWaitingInput,
    isSelectionCatalogLoading,
    selectedModelSelection,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    supportsSubagentReferences,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    skills,
    skillsError,
    isSkillsLoading,
    subagents,
    subagentsError,
    isSubagentsLoading,
    retrySlashCommands,
    retrySkills,
    retrySubagents,
    onCatalogMenuOpen,
    searchFiles,
    agentOptions,
    modelPicker,
    variantOptions,
    onSelectAgent,
    onSelectVariant,
    contextUsage,
    canStopSession,
    onStopSession,
    composerFormRef,
    composerEditorRef,
    onComposerEditorInput,
  } = model;
  // One object while the catalogs stay the same, so other model changes skip the editor.
  const focusComposerTitle = useShortcutTitle(
    "focus-composer",
    "Focus composer",
    !isComposerInputDisabled && !isSubmitting,
  );
  const editorCatalog = useMemo<AgentChatComposerEditorCatalog>(
    () => ({
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
      supportsSubagentReferences,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
      skills,
      skillsError,
      isSkillsLoading,
      subagents,
      subagentsError,
      isSubagentsLoading,
      retrySlashCommands,
      retrySkills,
      retrySubagents,
      onCatalogMenuOpen,
      searchFiles,
    }),
    [
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
      supportsSubagentReferences,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
      skills,
      skillsError,
      isSkillsLoading,
      subagents,
      subagentsError,
      isSubagentsLoading,
      retrySlashCommands,
      retrySkills,
      retrySubagents,
      onCatalogMenuOpen,
      searchFiles,
    ],
  );

  return (
    <form ref={composerFormRef} className="px-4 pb-4" action={submitAction}>
      <input
        ref={attachmentInputRef}
        type="file"
        aria-label="Add attachments"
        multiple
        accept={attachmentAccept}
        disabled={attachmentIntakeDisabled}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            onAddFiles(files);
          }
          event.currentTarget.value = "";
        }}
      />
      {/* Queue controls stay available while the runtime cannot receive messages. */}
      {model.messageQueue && !model.isReadOnly ? (
        <AgentChatMessageQueue model={model.messageQueue} composer={model} />
      ) : null}
      <AgentChatBackgroundTaskBar
        model={model.isReadOnly ? null : model.backgroundTasks}
        scope={model.displayedSessionKey}
      />
      <AgentChatGoalRow
        model={model.isReadOnly ? null : model.goalRow}
        scope={model.goalRowScope}
      />
      <div
        className={composerCardClassName({
          isWaitingInput,
          isInputMuted: isComposerInputDisabled && !isSubmitting,
        })}
      >
        {isSessionWorking && !isWaitingInput ? (
          <BorderRay
            strokeWidth={2.6}
            rayLengthRatio={0.12}
            {...(composerAccentColor ? { color: composerAccentColor } : {})}
          />
        ) : null}
        <div className="relative z-10">
          {model.messageQueue && !model.isReadOnly ? (
            <AgentChatMessageQueuePauseNotice model={model.messageQueue} />
          ) : null}
          <AgentChatComposerPendingNotices
            pendingSendItems={pendingSendItems}
            pendingSendBlockedReason={pendingSendBlockedReason}
          />
          <HandoffNotice notice={model.handoff?.notice} />
          <AgentChatComposerAttachments
            draft={draft}
            attachmentErrors={attachmentErrors}
            hasSlashAttachmentConflict={hasSlashAttachmentConflict}
            onRemoveAttachment={onRemoveAttachment}
          />
          <MemoizedAgentChatComposerEditor
            title={focusComposerTitle}
            draft={draft}
            onDraftChange={onDraftChange}
            onAddFiles={onAddFiles}
            placeholder={composerPlaceholder}
            disabled={isComposerInputDisabled}
            editorRef={composerEditorRef}
            onEditorInput={onComposerEditorInput}
            onSend={onSend}
            primaryMode={primaryMode}
            catalog={editorCatalog}
          />

          <SendNotice reason={sendBlockedReason} />
          <AgentChatComposerControls
            speed={model.speed}
            onPickAttachments={onPickAttachments}
            attachmentIntakeDisabled={attachmentIntakeDisabled}
            selectedModelSelection={selectedModelSelection}
            agentOptions={agentOptions}
            modelPicker={modelPicker}
            variantOptions={variantOptions}
            isSelectionCatalogLoading={isSelectionCatalogLoading}
            hardModelPickerReadOnlyReason={hardModelPickerReadOnlyReason}
            closedModelPickerDisabledReason={closedModelPickerDisabledReason}
            onSelectAgent={onSelectAgent}
            onSelectVariant={onSelectVariant}
            contextUsage={contextUsage}
            canStopSession={canStopSession}
            onStopSession={onStopSession}
            showSubmittingState={isSubmitting}
            sendDisabled={sendDisabled}
            pendingSendItems={pendingSendItems}
          />
        </div>
      </div>
    </form>
  );
}

function SendNotice({ reason }: { reason: string | null }): ReactElement | null {
  if (!reason) return null;
  return (
    <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
      {reason}
    </p>
  );
}

function useAgentChatComposerFocus({
  composerEditorRef,
  displayedSessionKey,
  isComposerInputDisabled,
}: {
  composerEditorRef: AgentChatComposerModel["composerEditorRef"];
  displayedSessionKey: string | null;
  isComposerInputDisabled: boolean;
}): () => void {
  const composerAutofocusStateRef = useRef<ReturnType<typeof createComposerAutofocusState> | null>(
    null,
  );

  const focusComposerEditor = useCallback((): boolean => {
    const editor = composerEditorRef.current;
    if (!editor?.isConnected) return false;
    focusEditorEnd(editor);
    return editor.contains(editor.ownerDocument.activeElement);
  }, [composerEditorRef]);

  const scheduleComposerFocus = useCallback(() => {
    const requestAnimationFrameFn = globalThis.requestAnimationFrame;
    if (requestAnimationFrameFn !== undefined) {
      requestAnimationFrameFn(() => {
        focusComposerEditor();
      });
      return;
    }

    focusComposerEditor();
  }, [focusComposerEditor]);

  const isFocusInsideComposer = useCallback(
    (activeElement: Element | null): boolean => {
      const editor = composerEditorRef.current;
      return Boolean(
        editor && activeElement && (editor === activeElement || editor.contains(activeElement)),
      );
    },
    [composerEditorRef],
  );

  useLayoutEffect(() => {
    if (composerAutofocusStateRef.current === null) {
      composerAutofocusStateRef.current = createComposerAutofocusState();
    }

    const composerAutofocusState = composerAutofocusStateRef.current;
    const isComposerInteractive = !isComposerInputDisabled;
    const activeElement = globalThis.document?.activeElement ?? null;
    const focusInsideComposer = isFocusInsideComposer(activeElement);

    const autofocusResult = resolveComposerAutofocus(composerAutofocusState, {
      displayedSessionKey,
      isComposerInteractive,
      activeElement,
      focusInsideComposer,
    });
    composerAutofocusStateRef.current =
      autofocusResult.shouldFocus && !focusComposerEditor()
        ? {
            ...autofocusResult.nextState,
            pendingAutofocusSessionKey: displayedSessionKey,
            waitAnchor: activeElement,
          }
        : autofocusResult.nextState;
  }, [displayedSessionKey, isComposerInputDisabled, isFocusInsideComposer, focusComposerEditor]);

  return scheduleComposerFocus;
}
