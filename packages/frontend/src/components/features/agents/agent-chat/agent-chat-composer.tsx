import {
  Bot,
  Brain,
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
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
  pendingInlineCommentCount: number,
): boolean => {
  return draftHasMeaningfulContent(draft) || pendingInlineCommentCount > 0;
};

const SEND_COMMENT_BADGE_CLASS_NAME =
  "pointer-events-none absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-semibold leading-none text-neutral-950";

const AgentChatComposerControls = memo(function AgentChatComposerControls({
  onPickAttachments,
  attachmentIntakeDisabled,
  selectedModelSelection,
  agentOptions,
  modelOptions,
  modelGroups,
  variantOptions,
  isSelectionCatalogLoading,
  supportsProfiles,
  selectorDisabled,
  onSelectAgent,
  onSelectModel,
  onSelectVariant,
  contextUsage,
  canStopSession,
  onStopSession,
  showSubmittingState,
  sendDisabled,
  pendingInlineCommentCount,
}: {
  onPickAttachments: () => void;
  attachmentIntakeDisabled: boolean;
  selectedModelSelection: AgentChatComposerModel["selectedModelSelection"];
  agentOptions: AgentChatComposerModel["agentOptions"];
  modelOptions: AgentChatComposerModel["modelOptions"];
  modelGroups: AgentChatComposerModel["modelGroups"];
  variantOptions: AgentChatComposerModel["variantOptions"];
  isSelectionCatalogLoading: boolean;
  supportsProfiles: boolean;
  selectorDisabled: boolean;
  onSelectAgent: AgentChatComposerModel["onSelectAgent"];
  onSelectModel: AgentChatComposerModel["onSelectModel"];
  onSelectVariant: AgentChatComposerModel["onSelectVariant"];
  contextUsage: AgentChatComposerModel["contextUsage"];
  canStopSession: boolean;
  onStopSession: AgentChatComposerModel["onStopSession"];
  showSubmittingState: boolean;
  sendDisabled: boolean;
  pendingInlineCommentCount: number;
}): ReactElement {
  const hasVariantOptions = variantOptions.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 px-2.5 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-full border border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Add attachment"
          disabled={attachmentIntakeDisabled}
          onClick={onPickAttachments}
        >
          <Paperclip className="size-3.5" />
        </Button>
        {supportsProfiles ? (
          <div className="relative">
            <Bot className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Combobox
              value={selectedModelSelection?.profileId ?? ""}
              options={agentOptions}
              className="w-[22rem] max-w-[min(90vw,28rem)] p-0"
              placeholder={isSelectionCatalogLoading ? "Loading agents..." : "Agent"}
              searchPlaceholder="Search agent..."
              triggerClassName="!h-7 !w-auto max-w-[15rem] !rounded-full !border-input !bg-card !pl-7 !pr-2 text-xs text-foreground shadow-none hover:!bg-muted"
              disabled={selectorDisabled}
              onValueChange={onSelectAgent}
            />
          </div>
        ) : null}

        <div className="relative">
          <Brain className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Combobox
            value={
              selectedModelSelection
                ? `${selectedModelSelection.providerId}/${selectedModelSelection.modelId}`
                : ""
            }
            options={modelOptions}
            groups={modelGroups}
            matchAllSearchTerms
            className="w-[26rem] max-w-[min(90vw,34rem)] p-0"
            placeholder={isSelectionCatalogLoading ? "Loading models..." : "Model"}
            searchPlaceholder="Search model..."
            triggerClassName="!h-7 !w-auto max-w-[19rem] !rounded-full !border-input !bg-card !pl-7 !pr-2 text-xs text-foreground shadow-none hover:!bg-muted"
            disabled={selectorDisabled}
            onValueChange={onSelectModel}
          />
        </div>

        {hasVariantOptions ? (
          <div className="relative">
            <BrainCog className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Combobox
              value={selectedModelSelection?.variant ?? ""}
              options={variantOptions}
              className="w-[16rem] max-w-[min(90vw,22rem)] p-0"
              placeholder="Variant"
              searchPlaceholder="Search variant..."
              triggerClassName="!h-7 !w-auto max-w-[12rem] !rounded-full !border-input !bg-card !pl-7 !pr-2 text-xs text-foreground shadow-none hover:!bg-muted"
              disabled={selectorDisabled}
              onValueChange={onSelectVariant}
            />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {contextUsage ? (
          <div className="mr-3">
            <AgentContextUsageIndicator
              totalTokens={contextUsage.totalTokens}
              contextWindow={contextUsage.contextWindow}
              {...(typeof contextUsage.outputLimit === "number"
                ? { outputLimit: contextUsage.outputLimit }
                : {})}
            />
          </div>
        ) : null}
        {canStopSession ? (
          <Button
            type="button"
            size="icon"
            className="size-8 rounded-full border-0 bg-red-500 text-white shadow-sm hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
            aria-label="Stop session"
            onClick={onStopSession}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : null}
        <div className="relative">
          <Button
            type="submit"
            size="icon"
            className="size-8 rounded-full"
            aria-label={showSubmittingState ? "Preparing message" : "Send message"}
            disabled={sendDisabled}
          >
            {showSubmittingState ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="size-3.5" />
            )}
          </Button>
          {pendingInlineCommentCount > 0 ? (
            <span
              className={SEND_COMMENT_BADGE_CLASS_NAME}
              data-testid="agent-chat-send-comment-badge"
            >
              {pendingInlineCommentCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

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
  sendDisabled,
  onAddFiles,
  onDraftChange,
  onPickAttachments,
  onRemoveAttachment,
  onSend,
  submitAction,
}: AgentChatComposerFormViewProps): ReactElement {
  const {
    pendingInlineCommentCount,
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
    searchFiles,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    onSelectAgent,
    onSelectModel,
    onSelectVariant,
    contextUsage,
    canStopSession,
    onStopSession,
    composerFormRef,
    composerEditorRef,
    onComposerEditorInput,
  } = model;

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
      {(draft.attachments ?? []).length > 0 ? (
        <section className="mb-0 border border-input border-b-0 border-l-0 bg-card shadow-md">
          <div
            className={composerAccentColor ? "border-l-4" : undefined}
            style={composerAccentColor ? { borderLeftColor: composerAccentColor } : undefined}
          >
            <div className="px-3 pb-3 pt-3">
              <div className="flex flex-wrap gap-3">
                {(draft.attachments ?? []).map((attachment) => (
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
                <p className="mt-3 text-xs text-destructive">
                  Remove attachments before running a slash command.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <div
        className={
          isWaitingInput
            ? "odt-waiting-input-card relative border border-warning-border bg-card shadow-md focus-within:shadow-xl"
            : "relative border border-input border-l-0 bg-card shadow-md focus-within:shadow-xl"
        }
      >
        {isSessionWorking && !isWaitingInput ? (
          <BorderRay
            strokeWidth={2.6}
            rayLengthRatio={0.12}
            {...(composerAccentColor ? { color: composerAccentColor } : {})}
          />
        ) : null}
        <div
          className={isWaitingInput ? "relative z-10" : "relative z-10 border-l-4"}
          style={
            composerAccentColor && !isWaitingInput
              ? { borderLeftColor: composerAccentColor }
              : undefined
          }
        >
          <AgentChatComposerEditor
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
            searchFiles={searchFiles}
          />

          <AgentChatComposerControls
            onPickAttachments={onPickAttachments}
            attachmentIntakeDisabled={attachmentIntakeDisabled}
            selectedModelSelection={selectedModelSelection}
            agentOptions={agentOptions}
            modelOptions={modelOptions}
            modelGroups={modelGroups}
            variantOptions={variantOptions}
            isSelectionCatalogLoading={isSelectionCatalogLoading}
            supportsProfiles={supportsProfiles ?? true}
            selectorDisabled={selectorDisabled}
            onSelectAgent={onSelectAgent}
            onSelectModel={onSelectModel}
            onSelectVariant={onSelectVariant}
            contextUsage={contextUsage}
            canStopSession={canStopSession}
            onStopSession={onStopSession}
            showSubmittingState={isSubmitting}
            sendDisabled={sendDisabled}
            pendingInlineCommentCount={pendingInlineCommentCount}
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
  if (composerAutofocusStateRef.current === null) {
    composerAutofocusStateRef.current = createComposerAutofocusState();
  }

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
    if (typeof requestAnimationFrameFn === "function") {
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
    const composerAutofocusState = composerAutofocusStateRef.current;
    if (composerAutofocusState === null) {
      throw new Error("Composer autofocus state was not initialized.");
    }

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

export function AgentChatComposer({
  model,
  ref,
}: {
  model: AgentChatComposerModel;
  ref?: Ref<AgentChatComposerHandle>;
}): ReactElement {
  const {
    taskId,
    displayedSessionKey,
    isInteractionEnabled,
    isReadOnly,
    readOnlyReason,
    busySendBlockedReason,
    pendingInlineCommentCount,
    draftStateKey,
    draftPersistenceIdentity,
    onSend,
    isSending,
    isStarting,
    isSessionWorking,
    isWaitingInput,
    waitingInputPlaceholder,
    isModelSelectionPending,
    selectedModelDescriptor,
    isSelectionCatalogLoading,
    supportsAttachments,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    supportsSubagentReferences,
    accentColor: composerAccentColor,
    composerEditorRef,
    onComposerEditorInput,
    syncBottomAfterComposerLayoutRef,
  } = model;

  const {
    draft,
    commitDraft,
    setDisplayedDraft,
    createSubmittedDraftSnapshot,
    clearSubmittedDraft,
    restoreSubmittedDraft,
  } = useAgentChatComposerDraftState({
    draftStateKey,
    persistenceIdentity: draftPersistenceIdentity,
    taskId,
  });
  const latestDraftRef = useRef<AgentChatComposerDraft>(draft);
  const latestSendDisabledRef = useRef(false);
  const latestOnSendRef = useRef(onSend);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const isSubmitting = (isSending && !isSessionWorking) || isStarting || isModelSelectionPending;
  const isComposerInputDisabled =
    !isInteractionEnabled ||
    isReadOnly ||
    isModelSelectionPending ||
    isWaitingInput ||
    Boolean(busySendBlockedReason);
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
  const attachmentLayoutKey = useMemo(() => {
    const attachments = draft.attachments ?? [];
    if (attachments.length === 0) {
      return null;
    }

    return attachments
      .map((attachment) => `${attachment.id}:${attachmentErrors[attachment.id] ?? "ok"}`)
      .join("|");
  }, [attachmentErrors, draft.attachments]);
  const previousAttachmentLayoutKeyRef = useRef<string | null | undefined>(undefined);

  const sendDisabled =
    (isSending && !isSessionWorking) ||
    isStarting ||
    isWaitingInput ||
    Boolean(busySendBlockedReason) ||
    isModelSelectionPending ||
    isReadOnly ||
    hasBlockingAttachments ||
    hasSlashAttachmentConflict ||
    !taskId ||
    !hasComposerSendContent(draft, pendingInlineCommentCount) ||
    !isInteractionEnabled;

  useLayoutEffect(() => {
    latestDraftRef.current = draft;
    latestOnSendRef.current = onSend;
    latestSendDisabledRef.current = sendDisabled;
  }, [draft, onSend, sendDisabled]);

  useLayoutEffect(() => {
    if (previousAttachmentLayoutKeyRef.current === attachmentLayoutKey) {
      return;
    }

    const previousAttachmentLayoutKey = previousAttachmentLayoutKeyRef.current;
    previousAttachmentLayoutKeyRef.current = attachmentLayoutKey;
    if (typeof previousAttachmentLayoutKey === "undefined") {
      return;
    }

    syncBottomAfterComposerLayoutRef.current?.();
  }, [attachmentLayoutKey, syncBottomAfterComposerLayoutRef]);

  const selectorDisabled =
    !taskId || isSelectionCatalogLoading || isSubmitting || !isInteractionEnabled || isReadOnly;

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
    const submittedDraft = latestDraftRef.current;
    const submittedSnapshot = createSubmittedDraftSnapshot(submittedDraft);
    setDisplayedDraft(createEmptyComposerDraft());
    onComposerEditorInput();
    scheduleComposerFocus();
    try {
      const didSend = await latestOnSendRef.current(submittedDraft);
      if (!didSend) {
        restoreSubmittedDraft(submittedSnapshot);
        onComposerEditorInput();
        scheduleComposerFocus();
        return;
      }
      clearSubmittedDraft(submittedSnapshot);
      scheduleComposerFocus();
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.error("Unable to send message", {
        description,
      });
      restoreSubmittedDraft(submittedSnapshot);
      onComposerEditorInput();
      scheduleComposerFocus();
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
  return (
    <AgentChatComposerFormView
      model={model}
      draft={draft}
      attachmentInputRef={attachmentInputRef}
      attachmentErrors={attachmentErrors}
      attachmentIntakeDisabled={attachmentIntakeDisabled}
      composerAccentColor={composerAccentColor}
      composerPlaceholder={composerPlaceholder}
      hasSlashAttachmentConflict={hasSlashAttachmentConflict}
      isComposerInputDisabled={isComposerInputDisabled}
      isSubmitting={isSubmitting}
      selectorDisabled={selectorDisabled}
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
