import { Bot, Brain, BrainCog, LoaderCircle, SendHorizontal, Square } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { BorderRay } from "@/components/ui/border-ray";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentAccentColor } from "../agent-accent-color";
import type { AgentChatComposerModel } from "./agent-chat.types";
import { AgentContextUsageIndicator } from "./agent-context-usage-indicator";

export function AgentChatComposer({ model }: { model: AgentChatComposerModel }): ReactElement {
  const {
    taskId,
    agentStudioReady,
    isReadOnly,
    readOnlyReason,
    input,
    onInputChange,
    onSend,
    isSending,
    isStarting,
    isSessionWorking,
    isModelSelectionPending,
    selectedModelSelection,
    isSelectionCatalogLoading,
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
    composerTextareaRef,
    onComposerTextareaInput,
  } = model;

  const sendDisabled =
    isSending ||
    isStarting ||
    isSessionWorking ||
    isModelSelectionPending ||
    isReadOnly ||
    !taskId ||
    input.trim().length === 0 ||
    !agentStudioReady;

  const selectorDisabled =
    !taskId || isSelectionCatalogLoading || isStarting || !agentStudioReady || isReadOnly;

  const composerAccentColor = useMemo(() => {
    const agentName = selectedModelSelection?.profileId;
    if (!agentName) {
      return undefined;
    }
    return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
  }, [selectedModelSelection?.profileId, sessionAgentColors]);
  const handleSubmit = (): void => {
    if (sendDisabled) {
      return;
    }
    onSend();
  };
  const isSubmitting = isSending || isStarting || isModelSelectionPending;

  return (
    <form ref={composerFormRef} className="px-4 pb-4" action={handleSubmit}>
      <fieldset className="contents" disabled={isSubmitting}>
        <div className="relative border border-input bg-card shadow-md transition-[border-color,box-shadow,background-color] focus-within:shadow-xl">
          {isSessionWorking ? (
            <BorderRay
              strokeWidth={2.6}
              rayLengthRatio={0.12}
              {...(composerAccentColor ? { color: composerAccentColor } : {})}
            />
          ) : null}
          <div
            className="relative z-10 border-l-4"
            style={composerAccentColor ? { borderLeftColor: composerAccentColor } : undefined}
          >
            <Textarea
              ref={composerTextareaRef}
              rows={1}
              placeholder={
                isReadOnly && readOnlyReason
                  ? readOnlyReason
                  : "@ for files/agents; / for commands; ! for shell"
              }
              value={input}
              className="!min-h-0 h-11 max-h-[220px] resize-none overflow-y-hidden border-0 bg-transparent px-3 py-2.5 text-[15px] leading-6 shadow-none focus-visible:ring-0"
              disabled={!agentStudioReady || isReadOnly || isModelSelectionPending}
              onChange={(event) => onInputChange(event.currentTarget.value)}
              onInput={onComposerTextareaInput}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
            />

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
                    disabled={!agentStudioReady}
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
                  aria-label={
                    isSending || isModelSelectionPending ? "Preparing message" : "Send message"
                  }
                  disabled={sendDisabled}
                >
                  {isSending || isModelSelectionPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <SendHorizontal className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
