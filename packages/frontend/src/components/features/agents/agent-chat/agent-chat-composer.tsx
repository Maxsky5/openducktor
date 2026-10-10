import {
  AlertTriangle,
  Bot,
  BrainCog,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  Square,
} from "lucide-react";
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
import { toast } from "sonner";
import { SpeedSelect } from "../speed-select";
import { ModelPicker } from "@/components/features/agents/model-picker";
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import {
  buildComposerAttachmentFromFile,
  CHAT_ATTACHMENT_ACCEPT,
  readAttachmentFileName,
  validateComposerAttachments,
} from "./agent-chat-attachments";
import {
  createComposerAutofocusState,
  resolveComposerAutofocus,
} from "./agent-chat-composer-autofocus";
import {
  type AgentChatComposerDraft,
  appendAttachmentsToDraft,
  createEmptyComposerDraft,
  draftHasMeaningfulContent,
  draftHasSlashCommandSegment,
  removeAttachmentFromDraft,
} from "./agent-chat-composer-draft";
import { AgentChatComposerEditor } from "./agent-chat-composer-editor";
import {
  readEditableTextContent,
  setCaretOffsetWithinElement,
} from "./agent-chat-composer-selection";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";
import { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";

const MemoizedAgentChatComposerEditor = memo(AgentChatComposerEditor);

export type AgentChatComposerHandle = {
  addFiles: (files: File[]) => void;
};

type AgentChatComposerFormViewProps = {
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
  selectorDisabled: boolean;
  modelPickerDisabled: boolean;
  sendDisabled: boolean;
  onAddFiles: (files: File[]) => void;
  onDraftChange: (draft: AgentChatComposerDraft) => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: () => Promise<void>;
  submitAction: () => void;
};

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

const hasComposerSendContent = (
  draft: AgentChatComposerDraft,
  pendingSendItems: AgentChatComposerModel["pendingSendItems"],
): boolean => {
  return draftHasMeaningfulContent(draft) || (pendingSendItems?.count ?? 0) > 0;
};

// The attach button and the selectors stay quiet, so they do not compete with the draft text.
const COMPOSER_QUIET_CONTROL_CLASS_NAME =
  "text-muted-foreground shadow-none hover:text-foreground data-[state=open]:text-foreground";
// The selectors shrink and truncate their labels in a narrow pane.
const COMPOSER_SELECTOR_TRIGGER_CLASS_NAME = cn(
  COMPOSER_QUIET_CONTROL_CLASS_NAME,
  "!h-7 !w-auto shrink !rounded-lg !border-transparent !bg-transparent text-xs hover:!bg-muted data-[state=open]:!bg-muted",
);

const SEND_PENDING_ITEMS_BADGE_CLASS_NAME =
  "pointer-events-none absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-semibold leading-none text-neutral-950 ring-2 ring-card";

const AgentChatComposerSendControl = memo(function AgentChatComposerSendControl({
  sendDisabled,
  showSubmittingState,
  pendingSendItems,
}: {
  sendDisabled: boolean;
  showSubmittingState: boolean;
  pendingSendItems: AgentChatComposerModel["pendingSendItems"];
}): ReactElement {
  return (
    <div className="relative">
      <Button
        type="submit"
        size="icon"
        className="size-8 rounded-lg"
        aria-label={showSubmittingState ? "Preparing message" : "Send message"}
        disabled={sendDisabled}
      >
        {showSubmittingState ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <SendHorizontal className="size-3.5" />
        )}
      </Button>
      {pendingSendItems && pendingSendItems.count > 0 ? (
        <span
          aria-label={pendingSendItems.accessibleLabel}
          className={SEND_PENDING_ITEMS_BADGE_CLASS_NAME}
          data-testid="agent-chat-send-pending-items-badge"
          role="status"
        >
          {pendingSendItems.count}
        </span>
      ) : null}
    </div>
  );
});

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
              className="w-[16rem] max-w-[min(90vw,22rem)] p-0"
              placeholder="Effort"
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
            key={speed.key}
            model={{ ...speed, disabled: speed.disabled || modelPickerDisabled }}
            compact
            triggerClassName="hover:bg-muted hover:text-foreground"
          />
        )}
      </div>

      {/* In a narrow pane, the context meter wraps above stop and send, so they stay in view. */}
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

// The card has no border. Its surface and shadow set it apart from the transcript.
const COMPOSER_CARD_CLASS_NAME =
  "relative rounded-xl transition-[background-color,box-shadow] duration-150";
// Only the draft editor highlights the card. The other controls show their own focus ring.
const COMPOSER_CARD_FOCUS_CLASS_NAME = "has-[[data-composer-editor]:focus]:shadow-chat-focus";

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
  return cn(
    COMPOSER_CARD_CLASS_NAME,
    "bg-chat-surface shadow-chat",
    COMPOSER_CARD_FOCUS_CLASS_NAME,
  );
};

function AgentChatComposerFormView({
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
  const pendingItemsWarning = pendingSendItems?.warning ?? null;
  const showPendingItemsWarning =
    pendingItemsWarning !== null && (pendingSendItems?.count ?? 0) > 0;

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
          {showPendingItemsWarning ? (
            <div
              className="flex items-start gap-1.5 px-3 pt-2.5 text-[11px] text-amber-700 dark:text-amber-300"
              data-testid="agent-chat-pending-items-warning"
              role="status"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>{pendingItemsWarning}</span>
            </div>
          ) : null}
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
            supportsSlashCommands={supportsSlashCommands}
            supportsFileSearch={supportsFileSearch}
            supportsSkillReferences={supportsSkillReferences}
            supportsSubagentReferences={supportsSubagentReferences}
            slashCommands={slashCommands}
            slashCommandsError={slashCommandsError}
            isSlashCommandsLoading={isSlashCommandsLoading}
            skills={skills}
            skillsError={skillsError}
            isSkillsLoading={isSkillsLoading}
            subagents={subagents}
            subagentsError={subagentsError}
            isSubagentsLoading={isSubagentsLoading}
            retrySlashCommands={retrySlashCommands}
            retrySkills={retrySkills}
            retrySubagents={retrySubagents}
            onCatalogMenuOpen={onCatalogMenuOpen}
            searchFiles={searchFiles}
          />

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

  const focusComposerEditor = useCallback(() => {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }

    const textSegments = editor.querySelectorAll<HTMLElement>("[data-segment-id]");
    for (let index = textSegments.length - 1; index >= 0; index -= 1) {
      const segment = textSegments[index];
      if (!segment?.isContentEditable) {
        continue;
      }

      setCaretOffsetWithinElement(segment, readEditableTextContent(segment).length);
      return;
    }

    editor.focus();
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
    composerAutofocusStateRef.current = autofocusResult.nextState;
    if (autofocusResult.shouldFocus) {
      scheduleComposerFocus();
    }
  }, [
    displayedSessionKey,
    isComposerInputDisabled,
    isFocusInsideComposer,
    isSubmitting,
    scheduleComposerFocus,
  ]);

  return scheduleComposerFocus;
}

const composerPlaceholderFor = (model: AgentChatComposerModel): string => {
  const {
    supportsFileSearch,
    supportsSubagentReferences,
    supportsSlashCommands,
    supportsSkillReferences,
    isReadOnly,
    readOnlyReason,
    busySendBlockedReason,
    isWaitingInput,
    waitingInputPlaceholder,
  } = model;
  let referencePlaceholder: string | null = null;
  if (supportsFileSearch && supportsSubagentReferences) {
    referencePlaceholder = "@ for files and subagents";
  } else if (supportsSubagentReferences) {
    referencePlaceholder = "@ for subagents";
  } else if (supportsFileSearch) {
    referencePlaceholder = "@ for files";
  }
  const composerPlaceholderParts = [
    referencePlaceholder,
    supportsSlashCommands ? "/ for commands" : null,
    supportsSkillReferences ? "$ for skills" : null,
  ].filter((part): part is string => Boolean(part));
  let composerPlaceholder =
    composerPlaceholderParts.length > 0 ? composerPlaceholderParts.join("; ") : "Type a message";
  if (isReadOnly && readOnlyReason) {
    composerPlaceholder = readOnlyReason;
  }
  if (busySendBlockedReason) {
    composerPlaceholder = busySendBlockedReason;
  }
  if (isWaitingInput) {
    composerPlaceholder =
      waitingInputPlaceholder ?? "Resolve the pending request above to continue";
  }
  return composerPlaceholder;
};

const composerInputDisabledFor = ({
  isInteractionEnabled,
  isReadOnly,
  isModelSelectionPending,
  isWaitingInput,
  isResumingSession,
  busySendBlockedReason,
}: AgentChatComposerModel): boolean => {
  return (
    !isInteractionEnabled ||
    isReadOnly ||
    isModelSelectionPending ||
    isWaitingInput ||
    isResumingSession ||
    Boolean(busySendBlockedReason)
  );
};

const composerSelectorDisabledFor = (
  model: AgentChatComposerModel,
  modelPickerDisabled: boolean,
): boolean =>
  model.isSelectionCatalogLoading || modelPickerDisabled || !model.selectedModelSelection;

export function AgentChatComposer({
  model,
  ref,
}: {
  model: AgentChatComposerModel;
  ref?: Ref<AgentChatComposerHandle>;
}): ReactElement {
  const {
    displayedSessionKey,
    isInteractionEnabled,
    isReadOnly,
    pendingSendItems,
    draftScope,
    onSend,
    isSending,
    isStarting,
    isSessionWorking,
    isModelSelectionPending,
    selectedModelDescriptor,
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
  const latestDraftRef = useRef<AgentChatComposerDraft>(draft);
  const latestDraftScopeKeyRef = useRef(draftScope.key);
  const latestSendDisabledRef = useRef(false);
  const latestOnSendRef = useRef(onSend);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const isSubmitting = (isSending && !isSessionWorking) || isStarting || isModelSelectionPending;
  const isComposerInputDisabled = composerInputDisabledFor(model);
  const attachmentIntakeDisabled = !supportsAttachments || isComposerInputDisabled || isSubmitting;

  const handleDraftChange = useCallback(
    (nextDraft: AgentChatComposerDraft) => {
      latestDraftRef.current = nextDraft;
      commitDraft(nextDraft);
    },
    [commitDraft],
  );

  const handleRemoveAttachment = useCallback(
    (attachmentId: string): void => {
      handleDraftChange(removeAttachmentFromDraft(latestDraftRef.current, attachmentId));
      onComposerEditorInput();
    },
    [handleDraftChange, onComposerEditorInput],
  );

  const handleAddFiles = useCallback(
    (files: File[]): void => {
      if (attachmentIntakeDisabled) {
        return;
      }

      const attachments = files.flatMap((file) => {
        const attachment = buildComposerAttachmentFromFile(file);
        if (!attachment) {
          toast.error("Unsupported attachment type", {
            description: renderUnsupportedAttachmentDescription(
              readAttachmentFileName({ name: file.name, mime: file.type }),
            ),
          });
          return [];
        }
        return [attachment];
      });
      if (attachments.length === 0) {
        return;
      }
      handleDraftChange(appendAttachmentsToDraft(latestDraftRef.current, attachments));
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

  const attachmentErrors = useMemo(() => {
    return validateComposerAttachments(
      draft.attachments ?? [],
      selectedModelDescriptor?.attachmentSupport,
    );
  }, [draft.attachments, selectedModelDescriptor?.attachmentSupport]);
  const hasBlockingAttachments = Object.keys(attachmentErrors).length > 0;
  const hasSlashAttachmentConflict =
    (draft.attachments ?? []).length > 0 && draftHasSlashCommandSegment(draft);
  const isSendOrModelPending = isSubmitting || isModelChangePending(model);

  const sendDisabled =
    isSendOrModelPending ||
    isComposerInputDisabled ||
    hasBlockingAttachments ||
    hasSlashAttachmentConflict ||
    !hasComposerSendContent(draft, pendingSendItems);

  useLayoutEffect(() => {
    latestDraftScopeKeyRef.current = draftScope.key;
    latestDraftRef.current = draft;
    latestOnSendRef.current = onSend;
    latestSendDisabledRef.current = sendDisabled;
  }, [draft, draftScope.key, onSend, sendDisabled]);

  const modelPickerDisabled = isSendOrModelPending || !isInteractionEnabled || isReadOnly;
  const selectorDisabled = composerSelectorDisabledFor(model, modelPickerDisabled);

  const scheduleComposerFocus = useAgentChatComposerFocus({
    composerEditorRef,
    displayedSessionKey,
    isComposerInputDisabled,
    isSubmitting,
  });

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (latestSendDisabledRef.current) {
      return;
    }
    const submitDraft = latestOnSendRef.current;
    const submittedDraft = latestDraftRef.current;
    const submittedSnapshot = createSubmittedDraftSnapshot(submittedDraft);
    clearSubmittedDraft(submittedSnapshot);
    setDisplayedDraft(createEmptyComposerDraft());
    onComposerEditorInput();
    scheduleComposerFocus();
    try {
      const result = await submitDraft(submittedDraft);
      if (result !== true && result !== false) {
        restoreSubmittedDraft(submittedSnapshot, result);
        if (!result.inAppFeedbackHandled)
          toast.error("Unable to send message", { description: result.error.message });
        return;
      }
      if (!result) {
        restoreSubmittedDraft(submittedSnapshot);
        if (latestDraftScopeKeyRef.current === submittedSnapshot.key) {
          onComposerEditorInput();
          scheduleComposerFocus();
        }
        return;
      }
      if (latestDraftScopeKeyRef.current === submittedSnapshot.key) scheduleComposerFocus();
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.error("Unable to send message", {
        description,
      });
      restoreSubmittedDraft(submittedSnapshot);
      if (latestDraftScopeKeyRef.current === submittedSnapshot.key) {
        onComposerEditorInput();
        scheduleComposerFocus();
      }
    }
  }, [
    clearSubmittedDraft,
    createSubmittedDraftSnapshot,
    onComposerEditorInput,
    restoreSubmittedDraft,
    scheduleComposerFocus,
    setDisplayedDraft,
  ]);
  const submitComposerAction = useCallback((): void => {
    void handleSubmit();
  }, [handleSubmit]);
  return (
    <AgentChatComposerFormView
      model={model}
      draft={draft}
      attachmentInputRef={attachmentInputRef}
      attachmentErrors={attachmentErrors}
      attachmentIntakeDisabled={attachmentIntakeDisabled}
      composerAccentColor={composerAccentColor}
      composerPlaceholder={composerPlaceholderFor(model)}
      hasSlashAttachmentConflict={hasSlashAttachmentConflict}
      isComposerInputDisabled={isComposerInputDisabled}
      isSubmitting={isSubmitting}
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

const isModelChangePending = (model: AgentChatComposerModel): boolean =>
  Boolean(model.isSavingModel) || model.speed?.pending === true;
