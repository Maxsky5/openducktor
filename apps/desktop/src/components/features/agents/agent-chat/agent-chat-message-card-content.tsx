import {
  type AgentModelSelection,
  type AgentRole,
  isOdtWorkflowMutationToolName,
} from "@openducktor/core";
import { Brain, Hammer, MessageSquareQuote } from "lucide-react";
import { lazy, type ReactElement, Suspense } from "react";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";
import {
  getAssistantFooterData,
  roleLabel,
  SYSTEM_PROMPT_PREFIX,
  toSingleLineMarkdown,
} from "./agent-chat-message-card-model";
import {
  assistantRoleIcon,
  RegularToolMessage,
  WorkflowToolMessage,
} from "./agent-chat-message-card-tool-presenters";

const LazyMarkdownRenderer = lazy(async () => {
  const module = await import("@/components/ui/markdown-renderer");
  return { default: module.MarkdownRenderer };
});

const PLAIN_TEXT_CLASSES: Record<MarkdownRendererVariant, string> = {
  compact: "whitespace-pre-wrap text-[13px] leading-relaxed text-foreground",
  document: "whitespace-pre-wrap leading-6 text-foreground",
};

type PlainTextMarkdownFallbackProps = {
  content: string;
  variant: MarkdownRendererVariant;
};

const PlainTextMarkdownFallback = ({
  content,
  variant,
}: PlainTextMarkdownFallbackProps): ReactElement => {
  return <p className={PLAIN_TEXT_CLASSES[variant]}>{content}</p>;
};

type DeferredMarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
};

const DeferredMarkdownRenderer = ({
  markdown,
  variant = "document",
}: DeferredMarkdownRendererProps): ReactElement | null => {
  const content = markdown.trim();
  if (!content) {
    return null;
  }

  if (!hasMarkdownSyntaxHint(content)) {
    return <PlainTextMarkdownFallback content={content} variant={variant} />;
  }

  return (
    <Suspense fallback={<PlainTextMarkdownFallback content={content} variant={variant} />}>
      <LazyMarkdownRenderer markdown={content} variant={variant} />
    </Suspense>
  );
};

export type MessageHeaderProps = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  timeLabel: string;
  showHeader: boolean;
  assistantRole: AgentRole | null;
  compactPadding: boolean;
};

export const MessageHeader = ({
  message,
  sessionRole,
  timeLabel,
  showHeader,
  assistantRole,
  compactPadding,
}: MessageHeaderProps): ReactElement | null => {
  if (!showHeader) {
    return null;
  }

  return (
    <header
      className={cn(
        "mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        message.role === "assistant" ? "mb-2" : "mb-1",
        compactPadding ? "" : "px-1",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {message.role === "thinking" ? <Brain className="size-3" /> : null}
        {message.role === "tool" ? <Hammer className="size-3" /> : null}
        {message.role === "assistant" && assistantRole ? assistantRoleIcon(assistantRole) : null}
        {roleLabel(message.role, sessionRole, message)}
      </span>
      {timeLabel ? <span className="font-normal normal-case">{timeLabel}</span> : null}
    </header>
  );
};

type ReasoningMessageProps = {
  content: string;
  completed: boolean;
  timeLabel: string;
};

const ReasoningMessage = ({
  content,
  completed,
  timeLabel,
}: ReasoningMessageProps): ReactElement => {
  if (completed) {
    return (
      <details className="px-1 py-0.5">
        <summary className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-foreground">
          <Brain className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium text-muted-foreground">Thinking</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {toSingleLineMarkdown(content || "Reasoning complete")}
          </span>
          {timeLabel ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
          ) : null}
        </summary>
        <div className="pl-6 pt-2">
          <DeferredMarkdownRenderer markdown={content || "Reasoning complete"} variant="compact" />
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-1 px-1 py-0.5 text-xs text-foreground">
      <div className="flex min-h-6 items-center gap-2">
        <Brain className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-muted-foreground">Thinking</span>
        {timeLabel ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
        ) : null}
      </div>
      <DeferredMarkdownRenderer markdown={content || "Thinking..."} variant="compact" />
    </div>
  );
};

type AssistantMessageProps = {
  message: AgentChatMessage;
  sessionSelectedModel: AgentModelSelection | null;
  assistantAccentColor: string | undefined;
};

const AssistantMessage = ({
  message,
  sessionSelectedModel,
  assistantAccentColor,
}: AssistantMessageProps): ReactElement => {
  const footer = getAssistantFooterData(message, sessionSelectedModel);
  return (
    <div className="space-y-2">
      <DeferredMarkdownRenderer markdown={message.content} variant="document" />
      {footer.infoParts.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="size-1.5 rounded-sm bg-amber-500"
            style={assistantAccentColor ? { backgroundColor: assistantAccentColor } : undefined}
          />
          <span className="min-w-0 truncate">{footer.infoParts.join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
};

export type MessageBodyProps = {
  message: AgentChatMessage;
  sessionSelectedModel: AgentModelSelection | null;
  assistantAccentColor: string | undefined;
  timeLabel: string;
  systemPromptBody: string;
};

export const MessageBody = ({
  message,
  sessionSelectedModel,
  assistantAccentColor,
  timeLabel,
  systemPromptBody,
}: MessageBodyProps): ReactElement => {
  const meta = message.meta;

  if (meta?.kind === "reasoning") {
    return (
      <ReasoningMessage
        content={message.content}
        completed={meta.completed}
        timeLabel={timeLabel}
      />
    );
  }

  if (meta?.kind === "tool") {
    if (isOdtWorkflowMutationToolName(meta.tool)) {
      return <WorkflowToolMessage meta={meta} messageTimestamp={message.timestamp} />;
    }
    return (
      <RegularToolMessage
        meta={meta}
        messageContent={message.content}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
      />
    );
  }

  if (meta?.kind === "subtask") {
    return (
      <div className="flex min-h-6 items-center gap-2 px-1 py-0.5 text-xs text-violet-700">
        <MessageSquareQuote className="size-3.5 shrink-0 text-violet-500" />
        <p className="shrink-0 font-medium">subagent {meta.agent}</p>
        <p className="truncate text-violet-700/90">{meta.description}</p>
        {timeLabel ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
        ) : null}
      </div>
    );
  }

  if (message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX)) {
    return (
      <details className="rounded border border-border bg-muted/70">
        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
          Show system prompt
        </summary>
        <div className="border-t border-border px-2 py-2">
          <DeferredMarkdownRenderer markdown={systemPromptBody} variant="compact" />
        </div>
      </details>
    );
  }

  if (message.role === "user") {
    return (
      <>
        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        {timeLabel ? (
          <p className="mt-2 text-right text-[11px] font-medium text-muted-foreground">{timeLabel}</p>
        ) : null}
      </>
    );
  }

  if (message.role === "thinking" || message.role === "system") {
    return <p className="whitespace-pre-wrap leading-6 text-foreground">{message.content}</p>;
  }

  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        sessionSelectedModel={sessionSelectedModel}
        assistantAccentColor={assistantAccentColor}
      />
    );
  }

  return <DeferredMarkdownRenderer markdown={message.content} variant="document" />;
};
