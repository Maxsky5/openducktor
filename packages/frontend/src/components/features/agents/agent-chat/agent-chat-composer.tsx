import { Bot, BrainCog, Paperclip, Square } from "lucide-react";
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
import { SpeedSelect } from "../speed-select";
import { ModelPicker } from "@/components/features/agents/model-picker";
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { buildComposerAttachmentsFromFiles } from "./agent-chat-attachment-intake";
import {
  composerForegroundTurnActive,
  draftSteerBlockedReason,
  steersRunningTurn,
} from "./agent-chat-steering";
import { CHAT_ATTACHMENT_ACCEPT } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import {
  createComposerAutofocusState,
  resolveComposerAutofocus,
} from "./agent-chat-composer-autofocus";
import {
  type AgentChatComposerDraft,
  appendAttachmentsToDraft,
  createEmptyComposerDraft,
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
import { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { useComposerPolicy } from "./agent-chat-composer-policy";

const MemoizedAgentChatComposerEditor = memo(AgentChatComposerEditor);

export type AgentChatComposerHandle = {
  addFiles: (files: File[]) => void;
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
    supportsAttachments,
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
  });
  const draftRef = useRef<AgentChatComposerDraft>(draft);
  const defaultSendDisabledRef = useRef(false);
  const sendInputBlockedRef = useRef(false);
  const modelRef = useRef(model);
  const settingsReadyRef = useRef(settingsReady);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
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
  } = useComposerPolicy({ model, draft, primaryMode, settingsReady });
  const attachmentIntakeDisabled = !supportsAttachments || isComposerInputDisabled || isSubmitting;

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

  const isSendOrModelPending = isSubmitting || Boolean(model.isSavingModel);

  useLayoutEffect(() => {
    draftRef.current = draft;
    defaultSendDisabledRef.current = defaultSendDisabled;
    sendInputBlockedRef.current = sendInputBlocked;
    modelRef.current = model;
    settingsReadyRef.current = settingsReady;
  }, [draft, model, defaultSendDisabled, sendInputBlocked, settingsReady]);

  const modelPickerDisabled =
    isSendOrModelPending ||
    !isInteractionEnabled ||
    isReadOnly ||
    model.foregroundTurnActive === true ||
    model.isWaitingInput;
  const selectorDisabled = composerSelectorDisabledFor(model, modelPickerDisabled);

  const scheduleComposerFocus = useAgentChatComposerFocus({
    composerEditorRef,
    displayedSessionKey,
    isComposerInputDisabled,
    isSubmitting,
  });

  const handleSubmit = useCallback(
    async (mode: AgentMessageSubmitMode): Promise<void> => {
      if (!settingsReadyRef.current) return;
      const steersTurn = steersRunningTurn(mode, composerForegroundTurnActive(modelRef.current));
      if (steersTurn ? sendInputBlockedRef.current : defaultSendDisabledRef.current) {
        return;
      }
      const submitDraft = modelRef.current.onSend;
      const submittedDraft = draftRef.current;
      const steerBlockedReason = steersTurn
        ? draftSteerBlockedReason(submittedDraft, modelRef.current)
        : null;
      if (steerBlockedReason) {
        toast.error("Cannot steer this message", { description: steerBlockedReason });
        return;
      }
      const submittedSnapshot = createSubmittedDraftSnapshot(submittedDraft);
      clearSubmittedDraft(submittedSnapshot);
      setDisplayedDraft(createEmptyComposerDraft());
      onComposerEditorInput();
      scheduleComposerFocus();
      try {
        const result = await submitDraft(submittedDraft, mode);
        if (result !== true && result !== false) {
          restoreSubmittedDraft(submittedSnapshot, result);
          if (!result.inAppFeedbackHandled)
            toast.error("Unable to send message", { description: result.error.message });
          return;
        }
        if (!result) {
          restoreSubmittedDraft(submittedSnapshot);
          if (modelRef.current.draftScope.key === submittedSnapshot.key) {
            onComposerEditorInput();
            scheduleComposerFocus();
          }
          return;
        }
        if (modelRef.current.draftScope.key === submittedSnapshot.key) scheduleComposerFocus();
      } catch (error) {
        const description = error instanceof Error ? error.message : String(error);
        toast.error("Unable to send message", {
          description,
        });
        restoreSubmittedDraft(submittedSnapshot);
        if (modelRef.current.draftScope.key === submittedSnapshot.key) {
          onComposerEditorInput();
          scheduleComposerFocus();
        }
      }
    },
    [
      clearSubmittedDraft,
      createSubmittedDraftSnapshot,
      onComposerEditorInput,
      restoreSubmittedDraft,
      scheduleComposerFocus,
      setDisplayedDraft,
    ],
  );
  const submitComposerAction = useCallback((): void => {
    void handleSubmit(primaryMode);
  }, [handleSubmit, primaryMode]);
  return (
    <AgentChatComposerFormView
      primaryMode={primaryMode}
      sendBlockedReason={sendBlockedReason}
      model={model}
      draft={draft}
      attachmentInputRef={attachmentInputRef}
      attachmentErrors={attachmentErrors}
      attachmentIntakeDisabled={attachmentIntakeDisabled}
      composerAccentColor={composerAccentColor}
      composerPlaceholder={placeholder}
      hasSlashAttachmentConflict={hasSlashAttachmentConflict}
      isComposerInputDisabled={isComposerInputDisabled}
      isSubmitting={isSubmitting}
      pendingSendBlockedReason={pendingSendBlockedReason}
      selectorDisabled={selectorDisabled}
      modelPickerDisabled={modelPickerDisabled}
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
  attachmentErrors: Record<string, string>;
  attachmentIntakeDisabled: boolean;
  composerAccentColor: string | undefined;
  composerPlaceholder: string;
  hasSlashAttachmentConflict: boolean;
  isComposerInputDisabled: boolean;
  isSubmitting: boolean;
  pendingSendBlockedReason: string | null;
  selectorDisabled: boolean;
  modelPickerDisabled: boolean;
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
  supportsProfiles,
  selectorDisabled,
  modelPickerDisabled,
  onSelectAgent,
  onSelectVariant,
  onAgentSelectorOpen,
  onVariantSelectorOpen,
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
  supportsProfiles: boolean;
  selectorDisabled: boolean;
  modelPickerDisabled: boolean;
  onSelectAgent: AgentChatComposerModel["onSelectAgent"];
  onSelectVariant: AgentChatComposerModel["onSelectVariant"];
  onAgentSelectorOpen: AgentChatComposerModel["onAgentSelectorOpen"];
  onVariantSelectorOpen: AgentChatComposerModel["onVariantSelectorOpen"];
  contextUsage: AgentChatComposerModel["contextUsage"];
  canStopSession: boolean;
  onStopSession: AgentChatComposerModel["onStopSession"];
  showSubmittingState: boolean;
  sendDisabled: boolean;
  pendingSendItems: AgentChatComposerModel["pendingSendItems"];
}): ReactElement {
  const hasVariantOptions = variantOptions.length > 0;

  return (
    <div className="flex flex-wrap items-end gap-2 px-2 pb-2 pt-1">
      <div className="flex min-w-0 flex-auto flex-wrap items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn("size-7 rounded-lg hover:bg-muted", COMPOSER_QUIET_CONTROL_CLASS_NAME)}
          aria-label="Add attachment"
          disabled={attachmentIntakeDisabled}
          onClick={onPickAttachments}
        >
          <Paperclip className="size-3.5" />
        </Button>
        {supportsProfiles ? (
          <div className="relative min-w-0">
            <Bot className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Combobox
              value={selectedModelSelection?.profileId ?? ""}
              options={agentOptions}
              className="w-[22rem] max-w-[min(90vw,28rem)] p-0"
              placeholder={isSelectionCatalogLoading ? "Loading agents..." : "Agent"}
              searchPlaceholder="Search agent..."
              triggerClassName={cn(
                COMPOSER_SELECTOR_TRIGGER_CLASS_NAME,
                "max-w-[min(15rem,100%)] !pl-7 !pr-2",
              )}
              disabled={selectorDisabled}
              onValueChange={onSelectAgent}
              onOpenChange={(open) => {
                if (open) {
                  onAgentSelectorOpen();
                }
              }}
            />
          </div>
        ) : null}

        <ModelPicker
          popoverSide="top"
          popoverAvoidCollisions={false}
          runtimes={modelPicker.runtimes}
          value={modelPicker.value}
          favoriteState={modelPicker.favoriteState}
          selectionPolicy={
            modelPickerDisabled
              ? { kind: "read_only", reason: "Model selection is unavailable right now." }
              : modelPicker.selectionPolicy
          }
          placeholder={isSelectionCatalogLoading ? "Loading models..." : "Model"}
          triggerClassName={cn(
            COMPOSER_SELECTOR_TRIGGER_CLASS_NAME,
            "max-w-[min(19rem,100%)] !px-2",
          )}
          onValueChange={modelPicker.onValueChange}
          onOpenChange={modelPicker.onOpenChange}
        />

        {hasVariantOptions ? (
          <div className="relative min-w-0">
            <BrainCog className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Combobox
              value={selectedModelSelection?.variant ?? ""}
              options={variantOptions}
              className="w-[min(16rem,var(--radix-popover-content-available-width))] max-w-[min(90vw,22rem)] p-0"
              placeholder="Effort"
              popoverSide="top"
              popoverAvoidCollisions={false}
              searchPlaceholder="Search effort..."
              triggerClassName={cn(
                COMPOSER_SELECTOR_TRIGGER_CLASS_NAME,
                "max-w-[min(12rem,100%)] !pl-7 !pr-2",
              )}
              disabled={selectorDisabled}
              onValueChange={onSelectVariant}
              onOpenChange={(open) => {
                if (open) {
                  onVariantSelectorOpen();
                }
              }}
            />
          </div>
        ) : null}
        {speed && (
          <SpeedSelect
            popoverSide="top"
            popoverAvoidCollisions={false}
            key={speed.key}
            model={{ ...speed, disabled: speed.disabled || modelPickerDisabled }}
            compact
            triggerClassName="hover:bg-muted hover:text-foreground"
          />
        )}
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
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="size-8 rounded-lg"
              aria-label="Stop session"
              onClick={onStopSession}
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : null}
          <AgentChatComposerSendControl
            sendDisabled={sendDisabled}
            showSubmittingState={showSubmittingState}
            pendingSendItems={pendingSendItems}
          />
        </div>
      </div>
    </div>
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

function AgentChatComposerFormView({
  primaryMode,
  sendBlockedReason,
  model,
  draft,
  attachmentInputRef,
  attachmentErrors,
  attachmentIntakeDisabled,
  composerAccentColor,
  composerPlaceholder,
  hasSlashAttachmentConflict,
  isComposerInputDisabled,
  isSubmitting,
  pendingSendBlockedReason,
  selectorDisabled,
  modelPickerDisabled,
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
    supportsProfiles,
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
    onAgentSelectorOpen,
    onVariantSelectorOpen,
    contextUsage,
    canStopSession,
    onStopSession,
    composerFormRef,
    composerEditorRef,
    onComposerEditorInput,
  } = model;
  // One object while the catalogs stay the same, so other model changes skip the editor.
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
        accept={CHAT_ATTACHMENT_ACCEPT}
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
          <AgentChatComposerAttachments
            draft={draft}
            attachmentErrors={attachmentErrors}
            hasSlashAttachmentConflict={hasSlashAttachmentConflict}
            onRemoveAttachment={onRemoveAttachment}
          />
          <MemoizedAgentChatComposerEditor
            draft={draft}
            onDraftChange={onDraftChange}
            onAddFiles={onAddFiles}
            placeholder={composerPlaceholder}
            disabled={isComposerInputDisabled || isSubmitting}
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
            supportsProfiles={supportsProfiles ?? true}
            selectorDisabled={selectorDisabled}
            modelPickerDisabled={modelPickerDisabled}
            onSelectAgent={onSelectAgent}
            onSelectVariant={onSelectVariant}
            onAgentSelectorOpen={onAgentSelectorOpen}
            onVariantSelectorOpen={onVariantSelectorOpen}
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
  isSubmitting,
}: {
  composerEditorRef: AgentChatComposerModel["composerEditorRef"];
  displayedSessionKey: string | null;
  isComposerInputDisabled: boolean;
  isSubmitting: boolean;
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
    const isComposerInteractive = !isComposerInputDisabled && !isSubmitting;
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
  }, [
    displayedSessionKey,
    isComposerInputDisabled,
    isFocusInsideComposer,
    isSubmitting,
    focusComposerEditor,
  ]);

  return scheduleComposerFocus;
}

const composerSelectorDisabledFor = (
  model: AgentChatComposerModel,
  modelPickerDisabled: boolean,
): boolean =>
  model.isSelectionCatalogLoading || modelPickerDisabled || !model.selectedModelSelection;
