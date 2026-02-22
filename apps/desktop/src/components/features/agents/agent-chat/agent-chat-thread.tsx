import { AlertTriangle, Bot, Brain, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

export function AgentChatThread({
  model,
  children,
}: {
  model: AgentChatThreadModel;
  children?: ReactNode;
}): ReactElement {
  const {
    session,
    roleOptions,
    agentStudioReady,
    blockedReason,
    isLoadingChecks,
    onRefreshChecks,
    taskSelected,
    canKickoffNewSession,
    kickoffLabel,
    onKickoff,
    isStarting,
    isSending,
    sessionAgentColors,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    todoPanelCollapsed,
    onToggleTodoPanel,
    todoPanelBottomOffset,
    messagesContainerRef,
    onMessagesScroll,
  } = model;
  const streamingRoleDisplay = session?.draftAssistantText
    ? (roleOptions.find((entry) => entry.role === session.role) ?? null)
    : null;
  const StreamingRoleIcon = streamingRoleDisplay?.icon ?? Bot;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!agentStudioReady ? (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">{blockedReason}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-rose-300 bg-white text-rose-700 hover:bg-rose-100"
            disabled={isLoadingChecks}
            onClick={onRefreshChecks}
          >
            <RefreshCcw className={cn("size-3.5", isLoadingChecks ? "animate-spin" : "")} />
            Recheck
          </Button>
        </div>
      ) : null}

      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
        onScroll={onMessagesScroll}
      >
        {!session ? (
          <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            <p>
              {taskSelected
                ? isStarting
                  ? "Initializing session..."
                  : "Send a message to start a new session automatically."
                : "Select a task to begin."}
            </p>
            {canKickoffNewSession ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isStarting || isSending || !taskSelected || !agentStudioReady}
                onClick={onKickoff}
              >
                {isStarting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {kickoffLabel}
              </Button>
            ) : null}
          </div>
        ) : null}

        {session?.messages.map((message) => {
          const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
          const turnDurationMs = assistantMeta?.durationMs;
          const shouldShowTurnDuration =
            message.role === "assistant" &&
            typeof turnDurationMs === "number" &&
            turnDurationMs > 0;
          const isUserMessage = message.role === "user";
          return (
            <Fragment key={message.id}>
              {shouldShowTurnDuration ? (
                <AgentTurnDurationSeparator durationMs={turnDurationMs} />
              ) : null}
              <div className={cn(isUserMessage ? "pt-4" : undefined)}>
                <AgentChatMessageCard
                  message={message}
                  sessionRole={session.role}
                  sessionSelectedModel={session.selectedModel}
                  sessionAgentColors={sessionAgentColors}
                />
              </div>
            </Fragment>
          );
        })}

        {session?.draftAssistantText ? (
          <article className="px-1 py-1 text-sm text-slate-700">
            <header className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <StreamingRoleIcon className="size-3" />
              {streamingRoleDisplay?.label ?? "Assistant"} (streaming)
              <LoaderCircle className="size-3 animate-spin" />
            </header>
            <p className="whitespace-pre-wrap leading-6 text-slate-700">
              {session.draftAssistantText}
            </p>
          </article>
        ) : null}

        {session?.status === "running" &&
        !session.draftAssistantText &&
        session.pendingQuestions.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
            <LoaderCircle className="size-3.5 animate-spin text-slate-500" />
            <Brain className="size-3.5 text-violet-600" />
            Agent is thinking...
          </div>
        ) : null}

        {session?.pendingQuestions.map((request) => (
          <AgentSessionQuestionCard
            key={`${session.sessionId}:${request.requestId}`}
            request={request}
            disabled={!agentStudioReady}
            isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
            onSubmit={onSubmitQuestionAnswers}
          />
        ))}
      </div>

      {session ? (
        <div
          className="pointer-events-none absolute right-3 z-20"
          style={{ bottom: `${todoPanelBottomOffset}px` }}
        >
          <AgentSessionTodoPanel
            todos={session.todos}
            collapsed={todoPanelCollapsed}
            className="pointer-events-auto"
            onToggleCollapse={onToggleTodoPanel}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}
