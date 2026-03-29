import { Bot, Brain, BrainCog, LoaderCircle, SendHorizontal, Square } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type { AgentChatComposerModel } from "./agent-chat.types";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import { AgentChatComposerEditor } from "./agent-chat-composer-editor";
import {
  readEditableTextContent,
  setCaretOffsetWithinElement,
} from "./agent-chat-composer-selection";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";

const AgentChatComposerControls = memo(function AgentChatComposerControls({
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

export function AgentChatComposer({ model }: { model: AgentChatComposerModel }): ReactElement {
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
    isSelectionCatalogLoading,
    supportsSlashCommands,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
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
    scrollToBottomOnSendRef,
  } = model;

  const [draft, setDraft] = useState(createEmptyComposerDraft);
  const latestDraftRef = useRef<AgentChatComposerDraft>(draft);
  const latestSendDisabledRef = useRef(false);
  const latestOnSendRef = useRef(onSend);

  useEffect(() => {
    void draftStateKey;
    setDraft(createEmptyComposerDraft());
    onComposerEditorInput();
  }, [draftStateKey, onComposerEditorInput]);

  const handleDraftChange = useCallback((nextDraft: AgentChatComposerDraft) => {
    latestDraftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const sendDisabled =
    (isSending && !isSessionWorking) ||
    isStarting ||
    isWaitingInput ||
    Boolean(busySendBlockedReason) ||
    isModelSelectionPending ||
    isReadOnly ||
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
      await latestOnSendRef.current(submittedDraft);
      scrollToBottomOnSendRef.current?.();
      scheduleComposerFocus();
    } catch {
      setDraft((currentDraft) =>
        draftHasMeaningfulContent(currentDraft) ? currentDraft : submittedDraft,
      );
      onComposerEditorInput();
      scheduleComposerFocus();
    }
  }, [onComposerEditorInput, scheduleComposerFocus, scrollToBottomOnSendRef]);
  const isComposerInputDisabled =
    !agentStudioReady ||
    isReadOnly ||
    isModelSelectionPending ||
    isWaitingInput ||
    Boolean(busySendBlockedReason);
  let composerPlaceholder = "@ for files/agents; / for commands; ! for shell";
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
            slashCommands={slashCommands}
            slashCommandsError={slashCommandsError}
            isSlashCommandsLoading={isSlashCommandsLoading}
          />

          <AgentChatComposerControls
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
}
