import type { RuntimeKind } from "@openducktor/contracts";
import {
  isSubagentWaitingForInput,
  readSubagentDurationMs,
  readSubagentError,
  readSubagentSummary,
  SUBAGENT_WAITING_FOR_INPUT_LABEL,
  subagentDisplayName,
  subagentStatusLabel,
} from "@openducktor/frontend-core/sessions/session-view/subagent-activity";
import { AgentChatAssistantMessage } from "./agent-chat-assistant-message";
import { AgentChatImageGeneration } from "./agent-chat-image-generation";
import type { AgentModelCatalog } from "@openducktor/core";
import { Brain, Cpu, FileX, Hammer, LoaderCircle } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { readSentBrowserAnnotations } from "@/features/browser-annotations/browser-annotation-message";
import { BrowserAnnotationMessageChips } from "@/features/browser-annotations/browser-annotation-message-chips";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentChatToolCallPresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { AgentChatAttachmentChip } from "./agent-chat-attachment-chip";
import { toTranscriptAttachment } from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import { BrowserToolMessage } from "./agent-chat-browser-tool";
import { ComputerUseToolMessage } from "./agent-chat-computer-use";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { roleLabel } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import { resolveInstructionsMessage } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";
import type {
  SubagentMeta,
  ToolMeta,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import { AgentChatTaskTool } from "./agent-chat-task-tool";
import { renderUserMessageReferenceChip } from "./agent-chat-user-message-reference-chip";
import {
  buildUserMessageContent,
  readUserMessageText,
  type UserAttachmentPart,
  type UserMessageContentNode,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-user-message-content";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";
import { ArtifactToolMessage } from "./agent-chat-artifact-tool-message";
import { AssistantRoleIcon } from "./agent-role-icon";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import type { ParentSessionRuntimeContext } from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import { SubagentTranscriptButton } from "./subagent-transcript-button";
import { buildToolSummary } from "@openducktor/frontend-core/sessions/messages/tool-summary";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";

type MessageHeaderProps = {
  message: AgentChatMessage;
  timeLabel: string;
  showHeader: boolean;
  assistantRole: AgentRole | null;
  compactPadding: boolean;
};

export const MessageHeader = ({
  message,
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
        {message.role === "assistant" && assistantRole ? (
          <AssistantRoleIcon role={assistantRole} />
        ) : null}
        {roleLabel(message.role, message)}
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
  const sourceText = streaming ? content || "Thinking…" : content;
  return (
    <div className="px-1 py-0.5 text-muted-foreground">
      <div className="space-y-0.5 text-[13px] leading-relaxed">
        <span className="block text-[11px] font-medium text-muted-foreground">Thinking:</span>
        <div className="min-w-0">
          <AgentChatMarkdownRenderer
            markdown={sourceText}
            streaming={streaming}
            variant="compact"
            className={REASONING_MARKDOWN_CLASS_NAME}
          />
        </div>
      </div>
    </div>
  );
};

const renderUserMessageInlineContent = (
  nodes: UserMessageContentNode[] | null,
): ReactElement | null => {
  if (!nodes) {
    return null;
  }

  return (
    <AgentChatTranscriptProse className="leading-6">
      {nodes.map((node) =>
        node.kind === "text" ? (
          <Fragment key={node.key}>{node.text}</Fragment>
        ) : (
          renderUserMessageReferenceChip(node.part, node.key)
        ),
      )}
    </AgentChatTranscriptProse>
  );
};

type SessionNoticeMessageProps = {
  message: AgentChatMessage;
  timeLabel: string;
};

const subagentStatusClassName = (status: SubagentMeta["status"]): string => {
  if (status === "running") {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
  }
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (status === "cancelled") {
    return "border-cancelled-border bg-cancelled-surface text-cancelled-surface-foreground";
  }
  if (status === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300";
  }

  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
};

const SUBAGENT_WAITING_APPROVAL_CLASS_NAME =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300";

type SubagentMessageProps = {
  meta: SubagentMeta;
  parentSession: ParentSessionRuntimeContext | null;
  timeLabel: string;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestionCount?: number;
};

const SubagentMessage = ({
  meta,
  parentSession,
  timeLabel,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestionCount = 0,
}: SubagentMessageProps): ReactElement => {
  const summary = readSubagentSummary(meta);
  const error = readSubagentError(meta);
  const isRunning = meta.status === "running";
  const isWaitingForInput = isSubagentWaitingForInput(
    meta,
    subagentPendingApprovalCount + subagentPendingQuestionCount,
  );
  const durationMs = readSubagentDurationMs(meta);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="rounded-md border border-border bg-pending-surface p-2">
          <Cpu className="size-4 text-pending-accent" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {subagentDisplayName(meta)}
            </p>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isWaitingForInput
                  ? SUBAGENT_WAITING_APPROVAL_CLASS_NAME
                  : subagentStatusClassName(meta.status),
              )}
            >
              {isWaitingForInput
                ? SUBAGENT_WAITING_FOR_INPUT_LABEL
                : subagentStatusLabel(meta.status)}
            </span>
            {meta.executionMode ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {meta.executionMode}
              </span>
            ) : null}
            <div className="ml-auto inline-flex shrink-0 items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
              {isRunning && !isWaitingForInput ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : null}
              {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
              {timeLabel ? <span>{timeLabel}</span> : null}
            </div>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {summary ? (
                <AgentChatTranscriptProse className="text-sm text-muted-foreground line-clamp-2">
                  {summary}
                </AgentChatTranscriptProse>
              ) : null}
              {error ? (
                <AgentChatTranscriptProse className="text-sm font-medium text-destructive">
                  {error}
                </AgentChatTranscriptProse>
              ) : null}
            </div>
            <SubagentTranscriptButton parentSession={parentSession} meta={meta} />
          </div>
        </div>
      </div>
    </div>
  );
};

const SessionNoticeMessage = ({ message, timeLabel }: SessionNoticeMessageProps): ReactElement => {
  const meta = message.meta?.kind === "session_notice" ? message.meta : null;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
          {meta?.title ?? "Notice"}
        </p>
        <AgentChatTranscriptProse className="leading-6 text-inherit">
          {message.content}
        </AgentChatTranscriptProse>
      </div>
      {timeLabel ? <span className="shrink-0 text-[11px] opacity-70">{timeLabel}</span> : null}
    </div>
  );
};

// What a user message bubble shows: its text with reference chips inline, its sent browser
// annotations, and its attachments.
type UserMessageDisplay = {
  inline: ReactElement | null;
  annotations: ReactElement | null;
  attachments: UserAttachmentPart[];
};

const readUserMessageDisplay = (message: AgentChatMessage): UserMessageDisplay => {
  // Pending browser annotations go after the user text. The chat shows them as chips.
  const sent = readSentBrowserAnnotations(readUserMessageText(message));
  const { nodes, attachments } = buildUserMessageContent(message, sent?.textEnd ?? null);
  return {
    inline: renderUserMessageInlineContent(nodes),
    annotations: sent ? <BrowserAnnotationMessageChips annotations={sent.annotations} /> : null,
    attachments,
  };
};

const hasUserMessageDisplay = ({ inline, annotations, attachments }: UserMessageDisplay): boolean =>
  inline !== null || annotations !== null || attachments.length > 0;

const UserMessageDisplayContent = ({
  display: { inline, annotations, attachments },
}: {
  display: UserMessageDisplay;
}): ReactElement => (
  <>
    {inline}
    {annotations ? <div className={cn(inline && "mt-2")}>{annotations}</div> : null}
    {attachments.length > 0 ? (
      <div
        className={cn("flex flex-wrap items-center gap-2", (inline || annotations) && "mt-2 mb-1")}
      >
        {attachments.map((part) => (
          <AgentChatAttachmentChip
            key={part.attachment.id}
            variant="transcript"
            attachment={toTranscriptAttachment(part.attachment)}
            className="w-32"
          />
        ))}
      </div>
    ) : null}
  </>
);

/** The text, reference chips, and attachment chips of a user message, as its bubble shows them. */
export function UserMessageContent({ message }: { message: AgentChatMessage }): ReactElement {
  return <UserMessageDisplayContent display={readUserMessageDisplay(message)} />;
}

/** The first rendered line of a user message, or its attachment names when it has no text. */
export function UserMessageFirstLine({ message }: { message: AgentChatMessage }): ReactElement {
  const { inline, attachments } = readUserMessageDisplay(message);
  return (
    <div className="line-clamp-1">
      {inline ?? attachments.map((part) => part.attachment.name).join(", ")}
    </div>
  );
}

const UserMessageBubble = ({
  children,
  isUnread,
}: {
  children: ReactNode;
  isUnread: boolean;
}): ReactElement => (
  <div
    data-slot="user-message-bubble"
    className={cn(
      "max-w-full rounded-xl rounded-br-sm px-3.5 py-2 text-foreground",
      isUnread
        ? "border border-dashed border-pending-border bg-pending-surface"
        : "bg-chat-surface shadow-chat",
    )}
  >
    {children}
  </div>
);

const UserMessageMeta = ({
  isUnread,
  timeLabel,
}: {
  isUnread: boolean;
  timeLabel: string;
}): ReactElement => (
  <div className="mt-1 flex items-center justify-end gap-2 px-1">
    {isUnread ? (
      <span
        className="rounded-full border border-pending-border bg-pending-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pending-surface-foreground"
        title="The agent has not read this message yet."
      >
        Unread
      </span>
    ) : null}
    {timeLabel ? (
      <p className="text-right text-[11px] font-medium text-muted-foreground">{timeLabel}</p>
    ) : null}
  </div>
);

const UserMessage = ({
  message,
  timeLabel,
}: {
  message: AgentChatMessage;
  timeLabel: string;
}): ReactElement => {
  const isUnread = message.meta?.kind === "user" && message.meta.state === "queued";
  const display = readUserMessageDisplay(message);

  return (
    <>
      {hasUserMessageDisplay(display) ? (
        <UserMessageBubble isUnread={isUnread}>
          <UserMessageDisplayContent display={display} />
        </UserMessageBubble>
      ) : null}
      {isUnread || timeLabel ? <UserMessageMeta isUnread={isUnread} timeLabel={timeLabel} /> : null}
    </>
  );
};

type MessageBodyProps = {
  message: AgentChatMessage;
  modelCatalog: AgentModelCatalog | null;
  sessionRuntimeKind: RuntimeKind | null;
  parentSession: ParentSessionRuntimeContext | null;
  assistantAccentColor: string | undefined;
  isStreamingAssistantMessage: boolean;
  timeLabel: string;
  systemPromptBody: string;
  sessionWorkingDirectory?: string | null | undefined;
  toolCallPresentation: AgentChatToolCallPresentation | null;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestionCount?: number;
};

type ToolMessageBodyProps = {
  message: AgentChatMessage;
  meta: ToolMeta;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  toolCallPresentation: AgentChatToolCallPresentation | null;
};

const ToolMessageBody = ({
  message,
  meta,
  timeLabel,
  sessionWorkingDirectory,
  toolCallPresentation,
}: ToolMessageBodyProps): ReactElement => {
  if (meta.toolType === "computer_use") {
    return (
      <ComputerUseToolMessage
        meta={meta}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
      />
    );
  }
  if (!toolCallPresentation) {
    throw new Error(`Tool Call presentation is missing for ${meta.tool}.`);
  }
  if (toolCallPresentation.kind === "browser") {
    return (
      <BrowserToolMessage
        meta={meta}
        action={toolCallPresentation.action}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
      />
    );
  }
  if (toolCallPresentation.kind === "artifact") {
    if (toolCallPresentation.operation === "delete") {
      return (
        <WorkflowToolMessage
          meta={meta}
          messageTimestamp={message.timestamp}
          timeLabel={timeLabel}
          sessionWorkingDirectory={sessionWorkingDirectory}
          displayName={toolCallPresentation.displayName}
          summary={buildToolSummary(meta, message.content)}
          icon={<FileX className="size-3.5" />}
        />
      );
    }
    return (
      <ArtifactToolMessage
        meta={meta}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
        sessionWorkingDirectory={sessionWorkingDirectory}
      />
    );
  }
  if (toolCallPresentation.kind === "workflow") {
    return (
      <WorkflowToolMessage
        meta={meta}
        messageTimestamp={message.timestamp}
        timeLabel={timeLabel}
        sessionWorkingDirectory={sessionWorkingDirectory}
        displayName={toolCallPresentation.displayName}
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
      displayName={toolCallPresentation.displayName}
    />
  );
};

const SystemMessageDisclosure = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement => (
  <details className="rounded border border-border">
    <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {label}
    </summary>
    <div className="border-t border-border p-2">{children}</div>
  </details>
);

const renderSystemMessage = (
  message: AgentChatMessage,
  systemPromptBody: string,
  sessionRuntimeKind: RuntimeKind | null,
): ReactElement | null => {
  const instructions = resolveInstructionsMessage(message, systemPromptBody);
  if (instructions) {
    return (
      <SystemMessageDisclosure label={instructions.toggleLabel}>
        <AgentChatMarkdownRenderer markdown={instructions.markdown} variant="compact" />
      </SystemMessageDisclosure>
    );
  }
  if (message.role !== "system" || sessionRuntimeKind !== "opencode") return null;
  return (
    <SystemMessageDisclosure label="Show system message">
      <AgentChatTranscriptProse className="leading-6 text-foreground">
        {message.content}
      </AgentChatTranscriptProse>
    </SystemMessageDisclosure>
  );
};

export const MessageBody = ({
  message,
  modelCatalog,
  sessionRuntimeKind,
  parentSession,
  assistantAccentColor,
  isStreamingAssistantMessage,
  timeLabel,
  systemPromptBody,
  sessionWorkingDirectory,
  toolCallPresentation,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestionCount = 0,
}: MessageBodyProps): ReactElement => {
  const meta = message.meta;

  if (meta?.kind === "image_generation") {
    return <AgentChatImageGeneration part={meta} />;
  }

  if (meta?.kind === "reasoning") {
    return <ReasoningMessage content={message.content} streaming={!meta.completed} />;
  }

  if (meta?.kind === "tool") {
    if (toolCallPresentation?.kind === "task") {
      return (
        <AgentChatTaskTool
          meta={meta}
          tool={toolCallPresentation.taskTool}
          timeLabel={timeLabel}
          messageContent={message.content}
          messageTimestamp={message.timestamp}
          sessionWorkingDirectory={sessionWorkingDirectory}
        />
      );
    }
    return (
      <ToolMessageBody
        message={message}
        meta={meta}
        timeLabel={timeLabel}
        sessionWorkingDirectory={sessionWorkingDirectory}
        toolCallPresentation={toolCallPresentation}
      />
    );
  }

  if (meta?.kind === "subagent") {
    return (
      <SubagentMessage
        meta={meta}
        parentSession={parentSession}
        timeLabel={timeLabel}
        subagentPendingApprovalCount={subagentPendingApprovalCount}
        subagentPendingQuestionCount={subagentPendingQuestionCount}
      />
    );
  }

  if (meta?.kind === "session_notice") {
    return <SessionNoticeMessage message={message} timeLabel={timeLabel} />;
  }

  const systemMessage = renderSystemMessage(message, systemPromptBody, sessionRuntimeKind);
  if (systemMessage) return systemMessage;

  if (message.role === "user") {
    return <UserMessage message={message} timeLabel={timeLabel} />;
  }

  if (message.role === "thinking" || message.role === "system") {
    return (
      <AgentChatTranscriptProse className="leading-6 text-foreground">
        {message.content}
      </AgentChatTranscriptProse>
    );
  }

  if (message.role === "assistant") {
    return (
      <AgentChatAssistantMessage
        message={message}
        modelCatalog={modelCatalog}
        sessionRuntimeKind={sessionRuntimeKind}
        assistantAccentColor={assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
      />
    );
  }

  return <AgentChatMarkdownRenderer markdown={message.content} variant="document" />;
};
