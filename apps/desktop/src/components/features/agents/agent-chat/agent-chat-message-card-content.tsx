import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  type AgentRole,
  type AgentUserMessageDisplayPart,
  isOdtWorkflowMutationToolName,
} from "@openducktor/core";
import { Brain, Hammer, MessageSquareQuote } from "lucide-react";
import {
  Fragment,
  lazy,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import type { MarkdownRendererVariant } from "@/components/ui/markdown-renderer";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { AgentChatFileReferenceChip } from "./agent-chat-file-reference-chip";
import { hasMarkdownSyntaxHint } from "./agent-chat-markdown-hints";
import {
  getAssistantFooterData,
  roleLabel,
  SYSTEM_PROMPT_PREFIX,
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
  document: "whitespace-pre-wrap leading-6 py-4 text-foreground",
};
const TEXT_RENDER_PACE_MS = 24;
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/;

const pacedStep = (size: number): number => {
  if (size <= 12) {
    return 2;
  }
  if (size <= 48) {
    return 4;
  }
  if (size <= 96) {
    return 8;
  }
  return Math.min(24, Math.ceil(size / 8));
};

const nextPacedBoundary = (text: string, start: number): number => {
  const end = Math.min(text.length, start + pacedStep(text.length - start));
  const max = Math.min(text.length, end + 8);
  for (let index = end; index < max; index += 1) {
    if (TEXT_RENDER_SNAP.test(text[index] ?? "")) {
      return index + 1;
    }
  }
  return end;
};

const usePacedStreamingText = (text: string, streaming: boolean): string => {
  const [visibleText, setVisibleText] = useState(text);
  const shownRef = useRef(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearScheduled = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const sync = (nextText: string) => {
      shownRef.current = nextText;
      setVisibleText(nextText);
    };

    const run = () => {
      timeoutRef.current = null;
      if (!streaming) {
        sync(text);
        return;
      }
      if (!text.startsWith(shownRef.current) || text.length <= shownRef.current.length) {
        sync(text);
        return;
      }

      const end = nextPacedBoundary(text, shownRef.current.length);
      sync(text.slice(0, end));
      if (end < text.length) {
        timeoutRef.current = setTimeout(run, TEXT_RENDER_PACE_MS);
      }
    };

    if (!streaming) {
      clearScheduled();
      sync(text);
      return clearScheduled;
    }

    if (!text.startsWith(shownRef.current) || text.length < shownRef.current.length) {
      clearScheduled();
      sync(text);
      return clearScheduled;
    }

    if (text.length !== shownRef.current.length && timeoutRef.current === null) {
      timeoutRef.current = setTimeout(run, TEXT_RENDER_PACE_MS);
    }

    return clearScheduled;
  }, [streaming, text]);

  return visibleText;
};

type PlainTextMarkdownFallbackProps = {
  content: string;
  variant: MarkdownRendererVariant;
  className?: string;
};

const PlainTextMarkdownFallback = ({
  content,
  variant,
  className,
}: PlainTextMarkdownFallbackProps): ReactElement => {
  return <p className={cn(PLAIN_TEXT_CLASSES[variant], className)}>{content}</p>;
};

type DeferredMarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
  className?: string;
};

const DeferredMarkdownRenderer = ({
  markdown,
  variant = "document",
  className,
}: DeferredMarkdownRendererProps): ReactElement | null => {
  const content = markdown.trim();
  const classNameProps = className ? { className } : {};

  if (!content) {
    return null;
  }

  if (!hasMarkdownSyntaxHint(content)) {
    return <PlainTextMarkdownFallback content={content} variant={variant} {...classNameProps} />;
  }

  return (
    <Suspense
      fallback={
        <PlainTextMarkdownFallback content={content} variant={variant} {...classNameProps} />
      }
    >
      <LazyMarkdownRenderer markdown={content} variant={variant} {...classNameProps} />
    </Suspense>
  );
};

type MessageHeaderProps = {
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
  streaming: boolean;
};

const REASONING_MARKDOWN_CLASS_NAME = cn(
  "italic text-muted-foreground",
  "prose-p:my-0 prose-p:text-inherit",
  "prose-headings:my-1 prose-headings:text-inherit",
  "prose-ul:my-1 prose-ol:my-1",
  "prose-li:my-0.5 prose-li:text-inherit",
  "prose-strong:text-inherit prose-em:text-inherit prose-blockquote:text-inherit",
  "[&_code]:not-italic [&_pre]:not-italic",
);

const ReasoningMessage = ({ content, streaming }: ReasoningMessageProps): ReactElement => {
  const sourceText = streaming ? content || "Thinking..." : content;
  const pacedContent = usePacedStreamingText(sourceText, streaming);
  const renderedContent = useDeferredValue(pacedContent);
  return (
    <div className="px-1 py-0.5 text-muted-foreground">
      <div className="space-y-0.5 text-[13px] leading-relaxed">
        <span className="block text-[11px] font-medium text-muted-foreground">Thinking:</span>
        <div className="min-w-0">
          <DeferredMarkdownRenderer
            markdown={streaming ? renderedContent : pacedContent}
            variant="compact"
            className={REASONING_MARKDOWN_CLASS_NAME}
          />
        </div>
      </div>
    </div>
  );
};

type AssistantMessageProps = {
  message: AgentChatMessage;
  assistantAccentColor: string | undefined;
  isStreamingAssistantMessage: boolean;
};

const canCopyAssistantMessage = (
  message: AgentChatMessage,
  isStreamingAssistantMessage: boolean,
): boolean => {
  if (message.role !== "assistant" || message.content.trim().length === 0) {
    return false;
  }

  return !isStreamingAssistantMessage;
};

function AssistantMessageCopyButton({ markdown }: { markdown: string }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "AgentChatMessageCardContent",
  });

  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <CopyIconButton
      copied={copied}
      ariaLabel="Copy assistant message content"
      dataTestId="copy-assistant-message-content"
      className="absolute top-0 right-0 z-10 opacity-0 pointer-events-none transition-opacity group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
      onClick={handleCopy}
    />
  );
}

const AssistantMessage = ({
  message,
  assistantAccentColor,
  isStreamingAssistantMessage,
}: AssistantMessageProps): ReactElement => {
  const streaming = isStreamingAssistantMessage;
  const copyable = canCopyAssistantMessage(message, isStreamingAssistantMessage);
  const pacedContent = usePacedStreamingText(message.content, streaming);
  const renderedContent = useDeferredValue(pacedContent);
  const footer = getAssistantFooterData(message);
  return (
    <div className="group/message relative space-y-2 pr-9">
      {copyable ? <AssistantMessageCopyButton markdown={message.content} /> : null}
      <DeferredMarkdownRenderer
        markdown={streaming ? renderedContent : pacedContent}
        variant="document"
      />
      {footer.infoParts.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="size-1.5 rounded-sm bg-warning-accent"
            style={assistantAccentColor ? { backgroundColor: assistantAccentColor } : undefined}
          />
          <span className="min-w-0 truncate">{footer.infoParts.join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
};

type UserMessageInlineFileReferenceRange = {
  part: Extract<AgentUserMessageDisplayPart, { kind: "file_reference" }>;
  start: number;
  end: number;
};

const readVisibleUserMessageText = (parts: AgentUserMessageDisplayPart[]): string => {
  return parts
    .filter(
      (part): part is Extract<AgentUserMessageDisplayPart, { kind: "text" }> =>
        part.kind === "text" && !part.synthetic,
    )
    .map((part) => part.text)
    .join("");
};

const readRenderableUserMessageText = (
  parts: AgentUserMessageDisplayPart[],
  fallbackText: string,
): string => {
  const visibleText = readVisibleUserMessageText(parts);
  if (visibleText.length > 0) {
    return visibleText;
  }
  return fallbackText;
};

const readInlineUserFileReferenceRanges = (
  rawText: string,
  parts: AgentUserMessageDisplayPart[],
): UserMessageInlineFileReferenceRange[] => {
  return parts
    .flatMap((part) => {
      if (part.kind !== "file_reference" || !part.sourceText) {
        return [];
      }

      return [
        {
          part,
          start: part.sourceText.start,
          end: part.sourceText.end,
        } satisfies UserMessageInlineFileReferenceRange,
      ];
    })
    .filter((range) => range.start >= 0 && range.end >= range.start && range.end <= rawText.length)
    .sort((left, right) => left.start - right.start);
};

const pushUserMessageTextNode = (nodes: ReactNode[], text: string, key: string): void => {
  if (text.length === 0) {
    return;
  }

  nodes.push(<Fragment key={key}>{text}</Fragment>);
};

const renderUserMessageInlineContent = (
  rawText: string,
  parts: AgentUserMessageDisplayPart[],
): ReactElement | null => {
  const nodes: ReactNode[] = [];
  const inlineRanges = readInlineUserFileReferenceRanges(rawText, parts);
  const renderedInlineFileReferences = new Set<AgentUserMessageDisplayPart>();

  if (inlineRanges.length === 0) {
    pushUserMessageTextNode(nodes, rawText, "text");
  } else {
    let cursor = 0;

    for (const range of inlineRanges) {
      if (range.start < cursor || range.start > rawText.length || range.end > rawText.length) {
        continue;
      }

      pushUserMessageTextNode(nodes, rawText.slice(cursor, range.start), `text-${cursor}`);
      nodes.push(
        <AgentChatFileReferenceChip
          key={`file-${range.part.file.id}-${range.start}`}
          file={range.part.file}
          className="max-w-full align-middle"
          tooltip
        />,
      );
      renderedInlineFileReferences.add(range.part);
      cursor = range.end;
    }

    pushUserMessageTextNode(nodes, rawText.slice(cursor), `text-${cursor}`);
  }

  for (const part of parts) {
    if (part.kind !== "file_reference" || renderedInlineFileReferences.has(part)) {
      continue;
    }

    nodes.push(
      <AgentChatFileReferenceChip
        key={`file-${part.file.id}-unanchored`}
        file={part.file}
        className="max-w-full align-middle"
        tooltip
      />,
    );
  }

  if (nodes.length === 0) {
    return null;
  }

  return <p className="whitespace-pre-wrap leading-6">{nodes}</p>;
};

type SessionNoticeMessageProps = {
  message: AgentChatMessage;
  timeLabel: string;
};

const SessionNoticeMessage = ({ message, timeLabel }: SessionNoticeMessageProps): ReactElement => {
  const meta = message.meta?.kind === "session_notice" ? message.meta : null;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          {meta?.title ?? "Notice"}
        </p>
        <p className="whitespace-pre-wrap leading-6 text-inherit">{message.content}</p>
      </div>
      {timeLabel ? <span className="shrink-0 text-[11px] opacity-70">{timeLabel}</span> : null}
    </div>
  );
};

type MessageBodyProps = {
  message: AgentChatMessage;
  assistantAccentColor: string | undefined;
  isStreamingAssistantMessage: boolean;
  timeLabel: string;
  systemPromptBody: string;
  sessionWorkingDirectory?: string | null | undefined;
  workflowToolAliasesByCanonical?: RuntimeDescriptor["workflowToolAliasesByCanonical"] | undefined;
};

export const MessageBody = ({
  message,
  assistantAccentColor,
  isStreamingAssistantMessage,
  timeLabel,
  systemPromptBody,
  sessionWorkingDirectory,
  workflowToolAliasesByCanonical,
}: MessageBodyProps): ReactElement => {
  const meta = message.meta;

  if (meta?.kind === "reasoning") {
    return <ReasoningMessage content={message.content} streaming={!meta.completed} />;
  }

  if (meta?.kind === "tool") {
    if (isOdtWorkflowMutationToolName(meta.tool, workflowToolAliasesByCanonical)) {
      return (
        <WorkflowToolMessage
          meta={meta}
          messageTimestamp={message.timestamp}
          sessionWorkingDirectory={sessionWorkingDirectory}
          workflowToolAliasesByCanonical={workflowToolAliasesByCanonical}
        />
      );
    }
    return (
      <RegularToolMessage
        meta={meta}
        messageContent={message.content}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
        sessionWorkingDirectory={sessionWorkingDirectory}
        workflowToolAliasesByCanonical={workflowToolAliasesByCanonical}
      />
    );
  }

  if (meta?.kind === "subtask") {
    return (
      <div className="flex min-h-6 items-center gap-2 px-1 py-0.5 text-xs text-violet-700 dark:text-violet-300">
        <MessageSquareQuote className="size-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
        <p className="shrink-0 font-medium">subagent {meta.agent}</p>
        <p className="truncate text-violet-700/90 dark:text-violet-300/90">{meta.description}</p>
        {timeLabel ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{timeLabel}</span>
        ) : null}
      </div>
    );
  }

  if (meta?.kind === "session_notice") {
    return <SessionNoticeMessage message={message} timeLabel={timeLabel} />;
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
    const isQueuedUserMessage = meta?.kind === "user" && meta.state === "queued";
    const userParts = meta?.kind === "user" ? (meta.parts ?? []) : [];
    const userAttachments = userParts.filter(
      (part): part is Extract<AgentUserMessageDisplayPart, { kind: "attachment" }> =>
        part.kind === "attachment",
    );
    const userText = readRenderableUserMessageText(userParts, message.content);
    const userContent = renderUserMessageInlineContent(userText, userParts);

    return (
      <>
        {userContent}
        {userAttachments.length > 0 || isQueuedUserMessage || timeLabel ? (
          <div className="mt-2 flex items-end justify-between gap-3">
            {userAttachments.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {userAttachments.map((part) => (
                  <AgentChatAttachmentChip
                    key={part.attachment.id}
                    variant="transcript"
                    attachment={part.attachment}
                    className="w-32"
                  />
                ))}
              </div>
            ) : (
              <div />
            )}
            <div className="flex shrink-0 items-center justify-end gap-2 self-end">
              {isQueuedUserMessage ? (
                <span className="rounded-full border border-pending-border bg-pending-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-pending-surface-foreground">
                  Queued
                </span>
              ) : null}
              {timeLabel ? (
                <p className="text-right text-[11px] font-medium text-muted-foreground">
                  {timeLabel}
                </p>
              ) : null}
            </div>
          </div>
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
        assistantAccentColor={assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
      />
    );
  }

  return <DeferredMarkdownRenderer markdown={message.content} variant="document" />;
};
