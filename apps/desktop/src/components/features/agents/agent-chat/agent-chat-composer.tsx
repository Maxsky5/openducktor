import { Bot, Brain, BrainCog, LoaderCircle, SendHorizontal, Square } from "lucide-react";
import { type ReactElement, useMemo } from "react";
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
    input,
    onInputChange,
    onSend,
    isSending,
    isStarting,
    isSessionWorking,
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
    !taskId ||
    input.trim().length === 0 ||
    !agentStudioReady;

  const composerAccentColor = useMemo(() => {
    const agentName = selectedModelSelection?.opencodeAgent;
    if (!agentName) {
      return undefined;
    }
    return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
  }, [selectedModelSelection?.opencodeAgent, sessionAgentColors]);

  return (
    <form
      ref={composerFormRef}
      className="bg-slate-100 px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div
        className="rounded-none border-l-4 bg-white shadow-md transition-[border-color,box-shadow,background-color] focus-within:shadow-xl"
        style={composerAccentColor ? { borderLeftColor: composerAccentColor } : undefined}
      >
        <Textarea
          ref={composerTextareaRef}
          rows={1}
          placeholder="@ for files/agents; / for commands; ! for shell"
          value={input}
          className="!min-h-0 h-10 max-h-[220px] resize-none overflow-y-hidden border-0 bg-transparent px-3 py-2.5 text-[15px] leading-6 shadow-none focus-visible:ring-0"
          onChange={(event) => onInputChange(event.currentTarget.value)}
          onInput={onComposerTextareaInput}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-2.5 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <div className="relative">
              <Bot className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
              <Combobox
                value={selectedModelSelection?.opencodeAgent ?? ""}
                options={agentOptions}
                className="w-[22rem] max-w-[min(90vw,28rem)] p-0"
                placeholder={isSelectionCatalogLoading ? "Loading agents..." : "Agent"}
                searchPlaceholder="Search agent..."
                triggerClassName="!h-7 !w-auto max-w-[15rem] !rounded-full !border-slate-300 !bg-white !pl-7 !pr-2 text-xs text-slate-700 shadow-none hover:!bg-slate-100"
                disabled={!taskId || isSelectionCatalogLoading || isStarting || !agentStudioReady}
                onValueChange={onSelectAgent}
              />
            </div>

            <div className="relative">
              <Brain className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
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
                triggerClassName="!h-7 !w-auto max-w-[19rem] !rounded-full !border-slate-300 !bg-white !pl-7 !pr-2 text-xs text-slate-700 shadow-none hover:!bg-slate-100"
                disabled={!taskId || isSelectionCatalogLoading || isStarting || !agentStudioReady}
                onValueChange={onSelectModel}
              />
            </div>

            <div className="relative">
              <BrainCog className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
              <Combobox
                value={selectedModelSelection?.variant ?? ""}
                options={variantOptions}
                className="w-[16rem] max-w-[min(90vw,22rem)] p-0"
                placeholder={variantOptions.length > 0 ? "Variant" : "No variants"}
                searchPlaceholder="Search variant..."
                triggerClassName="!h-7 !w-auto max-w-[12rem] !rounded-full !border-slate-300 !bg-white !pl-7 !pr-2 text-xs text-slate-700 shadow-none hover:!bg-slate-100"
                disabled={!taskId || variantOptions.length === 0 || isStarting || !agentStudioReady}
                onValueChange={onSelectVariant}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {contextUsage ? (
              <AgentContextUsageIndicator
                totalTokens={contextUsage.totalTokens}
                contextWindow={contextUsage.contextWindow}
                {...(typeof contextUsage.outputLimit === "number"
                  ? { outputLimit: contextUsage.outputLimit }
                  : {})}
              />
            ) : null}
            {canStopSession ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-8 rounded-full border-slate-300 bg-white hover:bg-slate-100"
                disabled={!agentStudioReady}
                aria-label="Stop session"
                onClick={onStopSession}
              >
                <Square className="size-3.5" />
              </Button>
            ) : null}
            <Button
              type="submit"
              size="icon"
              className="size-8 rounded-full"
              aria-label={isSending ? "Sending message" : "Send message"}
              disabled={sendDisabled}
            >
              {isSending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <SendHorizontal className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
