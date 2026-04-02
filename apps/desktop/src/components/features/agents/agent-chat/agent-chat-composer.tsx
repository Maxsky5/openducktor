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
  forwardRef,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import {
  buildComposerAttachmentFromFile,
  CHAT_ATTACHMENT_ACCEPT,
  validateComposerAttachments,
} from "./agent-chat-attachments";
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

export type AgentChatComposerHandle = {
  addFiles: (files: File[]) => void;
};

const AgentChatComposerControls = memo(function AgentChatComposerControls({
  onPickAttachments,
  selectedModelSelection,
  agentOptions,
  modelOptions,
  modelGroups,
  variantOptions,
  isSelectionCatalogLoading,
  selectorDisabled,
  taskId,
  agentStudioReady,
  isStarting,
  isReadOnly,
  onSelectAgent,
  onSelectModel,
  onSelectVariant,
  contextUsage,
  canStopSession,
  onStopSession,
  showSubmittingState,
  sendDisabled,
}: {
  onPickAttachments: () => void;
  selectedModelSelection: AgentChatComposerModel["selectedModelSelection"];
  agentOptions: AgentChatComposerModel["agentOptions"];
  modelOptions: AgentChatComposerModel["modelOptions"];
  modelGroups: AgentChatComposerModel["modelGroups"];
  variantOptions: AgentChatComposerModel["variantOptions"];
  isSelectionCatalogLoading: boolean;
  selectorDisabled: boolean;
  taskId: string;
  agentStudioReady: boolean;
  isStarting: boolean;
  isReadOnly: boolean;
  onSelectAgent: AgentChatComposerModel["onSelectAgent"];
  onSelectModel: AgentChatComposerModel["onSelectModel"];
  onSelectVariant: AgentChatComposerModel["onSelectVariant"];
  contextUsage: AgentChatComposerModel["contextUsage"];
  canStopSession: boolean;
  onStopSession: AgentChatComposerModel["onStopSession"];
  showSubmittingState: boolean;
  sendDisabled: boolean;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 px-2.5 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-full border border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Add attachment"
          onClick={onPickAttachments}
        >
          <Paperclip className="size-3.5" />
        </Button>
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
            className="w-[26rem] max-w-[min(90vw,34rem)] p-0"
            placeholder={isSelectionCatalogLoading ? "Loading models..." : "Model"}
            searchPlaceholder="Search model..."
            triggerClassName="!h-7 !w-auto max-w-[19rem] !rounded-full !border-input !bg-card !pl-7 !pr-2 text-xs text-foreground shadow-none hover:!bg-muted"
            disabled={selectorDisabled}
            onValueChange={onSelectModel}
          />
        </div>

        <div className="relative">
          <BrainCog className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Combobox
            value={selectedModelSelection?.variant ?? ""}
            options={variantOptions}
            className="w-[16rem] max-w-[min(90vw,22rem)] p-0"
            placeholder={variantOptions.length > 0 ? "Variant" : "No variants"}
            searchPlaceholder="Search variant..."
            triggerClassName="!h-7 !w-auto max-w-[12rem] !rounded-full !border-input !bg-card !pl-7 !pr-2 text-xs text-foreground shadow-none hover:!bg-muted"
            disabled={
              !taskId ||
              variantOptions.length === 0 ||
              isStarting ||
              !agentStudioReady ||
              isReadOnly
            }
            onValueChange={onSelectVariant}
          />
        </div>
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
      </div>
    </div>
  );
});

export const AgentChatComposer = forwardRef<
  AgentChatComposerHandle,
  { model: AgentChatComposerModel }
>(function AgentChatComposer({ model }, ref): ReactElement {
  const {
    taskId,
    agentStudioReady,
    isReadOnly,
    readOnlyReason,
    busySendBlockedReason,
    draftStateKey,
    onSend,
    isSending,
    isStarting,
    isSessionWorking,
    isWaitingInput,
    waitingInputPlaceholder,
    isModelSelectionPending,
    selectedModelSelection,
    selectedModelDescriptor,
    isSelectionCatalogLoading,
    supportsSlashCommands,
    supportsFileSearch,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    searchFiles,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    onSelectAgent,
    onSelectModel,
    onSelectVariant,
    sessionAgentColors,
    contextUsage,
    canStopSession,
    onStopSession,
    composerFormRef,
    composerEditorRef,
    onComposerEditorInput,
  } = model;

  const [draft, setDraft] = useState(createEmptyComposerDraft);
  const latestDraftRef = useRef<AgentChatComposerDraft>(draft);
  const latestSendDisabledRef = useRef(false);
  const latestOnSendRef = useRef(onSend);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void draftStateKey;
    setDraft(createEmptyComposerDraft());
    onComposerEditorInput();
  }, [draftStateKey, onComposerEditorInput]);

  const handleDraftChange = useCallback((nextDraft: AgentChatComposerDraft) => {
    latestDraftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const handleAddFiles = useCallback(
    (files: File[]): void => {
      const attachments = files.flatMap((file) => {
        const attachment = buildComposerAttachmentFromFile(file);
        if (!attachment) {
          toast.error("Unsupported attachment type", {
            description: `${file.name} is not an image, audio file, video, or PDF.`,
          });
          return [];
        }
        return [attachment];
      });
      if (attachments.length === 0) {
        return;
      }
      setDraft((currentDraft) => {
        const nextDraft = appendAttachmentsToDraft(currentDraft, attachments);
        latestDraftRef.current = nextDraft;
        return nextDraft;
      });
      onComposerEditorInput();
    },
    [onComposerEditorInput],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles: handleAddFiles,
    }),
    [handleAddFiles],
  );

  const openAttachmentPicker = useCallback((): void => {
    attachmentInputRef.current?.click();
  }, []);

  const attachmentErrors = useMemo(() => {
    return validateComposerAttachments(
      draft.attachments ?? [],
      selectedModelDescriptor?.attachmentSupport,
    );
  }, [draft.attachments, selectedModelDescriptor?.attachmentSupport]);
  const hasBlockingAttachments = Object.keys(attachmentErrors).length > 0;
  const hasSlashAttachmentConflict =
    (draft.attachments ?? []).length > 0 && draftHasSlashCommandSegment(draft);

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
    !draftHasMeaningfulContent(draft) ||
    !agentStudioReady;

  latestDraftRef.current = draft;
  latestOnSendRef.current = onSend;
  latestSendDisabledRef.current = sendDisabled;

  const isSubmitting = (isSending && !isSessionWorking) || isStarting || isModelSelectionPending;
  const selectorDisabled =
    !taskId || isSelectionCatalogLoading || isSubmitting || !agentStudioReady || isReadOnly;

  const composerAccentColor = useMemo(() => {
    const agentName = selectedModelSelection?.profileId;
    if (!agentName) {
      return undefined;
    }
    return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
  }, [selectedModelSelection?.profileId, sessionAgentColors]);

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

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (latestSendDisabledRef.current) {
      return;
    }
    const submittedDraft = latestDraftRef.current;
    setDraft(createEmptyComposerDraft());
    onComposerEditorInput();
    scheduleComposerFocus();
    try {
      const didSend = await latestOnSendRef.current(submittedDraft);
      if (!didSend) {
        setDraft((currentDraft) =>
          draftHasMeaningfulContent(currentDraft) ? currentDraft : submittedDraft,
        );
        onComposerEditorInput();
        scheduleComposerFocus();
        return;
      }
      scheduleComposerFocus();
    } catch {
      setDraft((currentDraft) =>
        draftHasMeaningfulContent(currentDraft) ? currentDraft : submittedDraft,
      );
      onComposerEditorInput();
      scheduleComposerFocus();
    }
  }, [onComposerEditorInput, scheduleComposerFocus]);
  const isComposerInputDisabled =
    !agentStudioReady ||
    isReadOnly ||
    isModelSelectionPending ||
    isWaitingInput ||
    Boolean(busySendBlockedReason);
  let composerPlaceholder = "@ for files; / for commands; ! for shell";
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
    <form
      ref={composerFormRef}
      className="px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            handleAddFiles(files);
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
            <div className="flex items-center gap-2 border-b border-input/80 px-3 py-2">
              <Paperclip className="size-4 text-muted-foreground" />
              <p className="text-[13px] font-semibold text-foreground">Attachments</p>
              <p className="text-[11px] font-medium text-muted-foreground">
                {(draft.attachments ?? []).length}
              </p>
            </div>
            <div className="px-3 pb-3 pt-3">
              <div className="flex flex-wrap gap-3">
                {(draft.attachments ?? []).map((attachment) => (
                  <AgentChatAttachmentChip
                    key={attachment.id}
                    variant="draft"
                    attachment={attachment}
                    error={attachmentErrors[attachment.id] ?? null}
                    onRemove={() => {
                      setDraft((currentDraft) => {
                        const nextDraft = removeAttachmentFromDraft(currentDraft, attachment.id);
                        latestDraftRef.current = nextDraft;
                        return nextDraft;
                      });
                      onComposerEditorInput();
                    }}
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
            ? "odt-waiting-input-card relative border border-warning-border bg-card shadow-md transition-[border-color,box-shadow,background-color] focus-within:shadow-xl"
            : "relative border border-input border-l-0 bg-card shadow-md transition-[border-color,box-shadow,background-color] focus-within:shadow-xl"
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
            onDraftChange={handleDraftChange}
            placeholder={composerPlaceholder}
            disabled={isComposerInputDisabled || isSubmitting}
            editorRef={composerEditorRef}
            onEditorInput={onComposerEditorInput}
            onSend={handleSubmit}
            supportsSlashCommands={supportsSlashCommands}
            supportsFileSearch={supportsFileSearch}
            slashCommands={slashCommands}
            slashCommandsError={slashCommandsError}
            isSlashCommandsLoading={isSlashCommandsLoading}
            searchFiles={searchFiles}
          />

          <AgentChatComposerControls
            onPickAttachments={openAttachmentPicker}
            selectedModelSelection={selectedModelSelection}
            agentOptions={agentOptions}
            modelOptions={modelOptions}
            modelGroups={modelGroups}
            variantOptions={variantOptions}
            isSelectionCatalogLoading={isSelectionCatalogLoading}
            selectorDisabled={selectorDisabled}
            taskId={taskId}
            agentStudioReady={agentStudioReady}
            isStarting={isStarting}
            isReadOnly={isReadOnly}
            onSelectAgent={onSelectAgent}
            onSelectModel={onSelectModel}
            onSelectVariant={onSelectVariant}
            contextUsage={contextUsage}
            canStopSession={canStopSession}
            onStopSession={onStopSession}
            showSubmittingState={isSubmitting}
            sendDisabled={sendDisabled}
          />
        </div>
      </div>
    </form>
  );
});
