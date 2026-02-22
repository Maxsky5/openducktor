import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  type AgentModelSelection,
  type AgentRole,
  isOdtWorkflowMutationToolName,
} from "@openducktor/core";
import {
  Bot,
  Brain,
  FileText,
  Folder,
  Globe,
  Hammer,
  LoaderCircle,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { resolveAgentAccentColor } from "../agent-accent-color";
import {
  SYSTEM_PROMPT_PREFIX,
  assistantRoleFromMessage,
  buildToolSummary,
  formatRawJsonLikeText,
  formatTime,
  getAssistantFooterData,
  getToolDuration,
  hasNonEmptyInput,
  hasNonEmptyText,
  questionToolDetails,
  roleLabel,
  toSingleLineMarkdown,
  toolDisplayName,
} from "./agent-chat-message-card-model";
import { formatAgentDuration } from "./format-agent-duration";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  sessionSelectedModel: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
};

type ToolMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;

const MCP_TOOL_ERROR_PREFIX = /^\s*mcp\s+error\b/i;

const isToolMessageFailure = (meta: ToolMeta): boolean => {
  if (meta.status === "error") {
    return true;
  }

  if (
    meta.status === "completed" &&
    isOdtWorkflowMutationToolName(meta.tool) &&
    hasNonEmptyText(meta.output)
  ) {
    return MCP_TOOL_ERROR_PREFIX.test(meta.output);
  }

  return false;
};

const assistantRoleIcon = (role: AgentRole): ReactElement => {
  if (role === "spec") {
    return <Sparkles className="size-3" />;
  }
  if (role === "planner") {
    return <Bot className="size-3" />;
  }
  if (role === "build") {
    return <Wrench className="size-3" />;
  }
  return <ShieldCheck className="size-3" />;
};

const toolIcon = (toolName: string): ReactElement => {
  const value = toolName.toLowerCase();
  if (value === "read" || value === "cat" || value === "view") {
    return <FileText className="size-3.5" />;
  }
  if (value === "bash" || value === "shell") {
    return <Terminal className="size-3.5" />;
  }
  if (value === "list" || value === "ls" || value === "glob") {
    return <Folder className="size-3.5" />;
  }
  if (value === "grep" || value === "find" || value === "search") {
    return <Search className="size-3.5" />;
  }
  if (value.startsWith("web")) {
    return <Globe className="size-3.5" />;
  }
  return <Wrench className="size-3.5" />;
};

type ToolJsonDetailsProps = {
  label: "Input" | "Output" | "Error";
  value: string;
  className: string;
  titleClassName: string;
};

const ToolJsonDetails = ({
  label,
  value,
  className,
  titleClassName,
}: ToolJsonDetailsProps): ReactElement => {
  return (
    <details className={className}>
      <summary className={titleClassName}>{label}</summary>
      <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]">
        {formatRawJsonLikeText(value)}
      </pre>
    </details>
  );
};

type WorkflowToolMessageProps = {
  meta: ToolMeta;
  messageTimestamp: string;
};

const WorkflowToolMessage = ({
  meta,
  messageTimestamp,
}: WorkflowToolMessageProps): ReactElement => {
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const isRunning = meta.status === "running" || meta.status === "pending";
  const isFailure = isToolMessageFailure(meta);
  const isSuccessfulCompletion = meta.status === "completed" && !isFailure;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span>{toolIcon(meta.tool)}</span>
        <p
          className={cn(
            "text-xs font-semibold",
            isFailure
              ? "text-rose-900"
              : isSuccessfulCompletion
                ? "text-emerald-900"
                : "text-amber-900",
          )}
        >
          {toolDisplayName(meta.tool)}
        </p>
        {isRunning ? <LoaderCircle className="ml-auto size-3 animate-spin" /> : null}
        {!isRunning && durationMs !== null ? (
          <span className="ml-auto text-[11px] text-current/75">
            {formatAgentDuration(durationMs)}
          </span>
        ) : null}
      </div>
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <details className="rounded border border-current/20 bg-white/55">
              <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-current">
                Input
              </summary>
              <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-current">
                {JSON.stringify(meta.input, null, 2)}
              </pre>
            </details>
          ) : null}
          {hasOutput && meta.output ? (
            <ToolJsonDetails
              label="Output"
              value={meta.output}
              className="rounded border border-current/20 bg-white/55"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
            />
          ) : null}
          {hasError && meta.error ? (
            <ToolJsonDetails
              label="Error"
              value={meta.error}
              className="rounded border border-current/20 bg-white/55"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

const resolveAssistantAgentColor = (
  message: AgentChatMessage,
  sessionSelectedModel: AgentModelSelection | null,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  if (message.role !== "assistant") {
    return undefined;
  }
  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const agentName = assistantMeta?.opencodeAgent ?? sessionSelectedModel?.opencodeAgent;
  if (!agentName) {
    return undefined;
  }
  return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
};

type MessageHeaderProps = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  timeLabel: string;
  showHeader: boolean;
  assistantRole: AgentRole | null;
  compactPadding: boolean;
};

const MessageHeader = ({
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
        "mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
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
        <summary className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-slate-700">
          <Brain className="size-3.5 shrink-0 text-slate-500" />
          <span className="shrink-0 font-medium text-slate-500">Thinking</span>
          <span className="min-w-0 flex-1 truncate text-slate-600">
            {toSingleLineMarkdown(content || "Reasoning complete")}
          </span>
          {timeLabel ? (
            <span className="shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
          ) : null}
        </summary>
        <div className="pl-6 pt-2">
          <MarkdownRenderer markdown={content || "Reasoning complete"} variant="compact" />
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-1 px-1 py-0.5 text-xs text-slate-700">
      <div className="flex min-h-6 items-center gap-2">
        <Brain className="size-3.5 shrink-0 text-slate-500" />
        <span className="shrink-0 font-medium text-slate-500">Thinking</span>
        {timeLabel ? (
          <span className="ml-auto shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
        ) : null}
      </div>
      <MarkdownRenderer markdown={content || "Thinking..."} variant="compact" />
    </div>
  );
};

type RegularToolMessageProps = {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
};

const RegularToolMessage = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
}: RegularToolMessageProps): ReactElement => {
  const summary = buildToolSummary(meta, messageContent);
  const summaryText = summary.length > 0 ? summary : meta.status === "error" ? "Tool failed" : "";
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const hasExpandableDetails = hasInput || hasOutput || hasError;
  const isRunning = meta.status === "running" || meta.status === "pending";
  const questionDetails = questionToolDetails(meta);

  const summaryRow = (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 text-xs",
        hasExpandableDetails ? "cursor-pointer" : "",
        meta.status === "error" ? "text-rose-700" : "text-slate-700",
      )}
    >
      <span className={cn(meta.status === "error" ? "text-rose-500" : "text-slate-500")}>
        {toolIcon(meta.tool)}
      </span>
      <p className="shrink-0 font-medium text-current">{toolDisplayName(meta.tool)}</p>
      {summaryText.length > 0 ? <p className="truncate text-slate-600">{summaryText}</p> : null}
      <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
        {isRunning ? <LoaderCircle className="size-3 animate-spin" /> : null}
        {!isRunning && durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
        {timeLabel ? <span>{timeLabel}</span> : null}
      </span>
    </div>
  );

  return (
    <div className="space-y-1 px-1 py-0.5">
      {hasExpandableDetails ? (
        <details className="group">
          <summary className="list-none [&::-webkit-details-marker]:hidden">{summaryRow}</summary>
          <div className="ml-5 mt-1 space-y-2">
            {hasInput && meta.input ? (
              <details className="rounded border border-slate-200 bg-white">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-700">
                  Input
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-slate-700">
                  {JSON.stringify(meta.input, null, 2)}
                </pre>
              </details>
            ) : null}
            {hasOutput && meta.output ? (
              <details className="rounded border border-slate-200 bg-white">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-700">
                  Output
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-slate-700">
                  {formatRawJsonLikeText(meta.output)}
                </pre>
              </details>
            ) : null}
            {hasError && meta.error ? (
              <details className="rounded border border-rose-200 bg-rose-50/60">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-rose-700">
                  Error
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-rose-700">
                  {formatRawJsonLikeText(meta.error)}
                </pre>
              </details>
            ) : null}
          </div>
        </details>
      ) : (
        summaryRow
      )}

      {questionDetails.length > 0 ? (
        <details className="ml-5 rounded border border-slate-200 bg-white/80">
          <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-slate-700">
            Questions and answers
          </summary>
          <div className="space-y-2 border-t border-slate-200 px-2 py-2 text-xs text-slate-700">
            {questionDetails.map((entry, index) => (
              <div key={`${meta.callId}:question:${index}`} className="space-y-0.5">
                <p className="font-medium text-slate-700">{entry.prompt}</p>
                <p
                  className={cn(
                    "whitespace-pre-wrap",
                    entry.answers.length > 0 ? "text-slate-900" : "italic text-slate-500",
                  )}
                >
                  {entry.answers.length > 0 ? entry.answers.join(", ") : "No answer yet"}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
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
      <MarkdownRenderer markdown={message.content} variant="document" />
      {footer.infoParts.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
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

type MessageBodyProps = {
  message: AgentChatMessage;
  sessionSelectedModel: AgentModelSelection | null;
  assistantAccentColor: string | undefined;
  timeLabel: string;
  systemPromptBody: string;
};

const MessageBody = ({
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
          <span className="ml-auto shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
        ) : null}
      </div>
    );
  }

  if (message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX)) {
    return (
      <details className="rounded border border-slate-200 bg-slate-50/70">
        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-700">
          Show system prompt
        </summary>
        <div className="border-t border-slate-200 px-2 py-2">
          <MarkdownRenderer markdown={systemPromptBody} variant="compact" />
        </div>
      </details>
    );
  }

  if (message.role === "user") {
    return (
      <>
        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        {timeLabel ? (
          <p className="mt-2 text-right text-[11px] font-medium text-slate-500">{timeLabel}</p>
        ) : null}
      </>
    );
  }

  if (message.role === "thinking" || message.role === "system") {
    return <p className="whitespace-pre-wrap leading-6 text-slate-700">{message.content}</p>;
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

  return <MarkdownRenderer markdown={message.content} variant="document" />;
};

const toArticleClassName = (
  message: AgentChatMessage,
  isUserMessage: boolean,
  isToolMessage: boolean,
  isWorkflowToolMessage: boolean,
  isSubtaskMessage: boolean,
  isSystemPromptMessage: boolean,
): string => {
  const meta = message.meta;
  const workflowToolFailed =
    isWorkflowToolMessage && meta?.kind === "tool" ? isToolMessageFailure(meta) : false;
  const workflowToolCompleted =
    isWorkflowToolMessage && meta?.kind === "tool"
      ? meta.status === "completed" && !workflowToolFailed
      : false;
  return cn(
    "text-sm",
    isUserMessage &&
      "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm border border-sky-100 bg-sky-50 px-4 py-3 text-slate-900 shadow-sm",
    isToolMessage
      ? isWorkflowToolMessage
        ? workflowToolCompleted
          ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          : workflowToolFailed
            ? "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900"
            : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        : "border-none bg-transparent px-0 py-0 text-slate-800"
      : isSubtaskMessage
        ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        : isSystemPromptMessage
          ? "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800"
          : message.role === "assistant"
            ? "border-l-2 border-slate-200 pl-3 pr-1 py-1 text-slate-800"
            : isUserMessage
              ? ""
              : "border-none bg-transparent px-0 py-0 text-slate-800",
  );
};

export function AgentChatMessageCard({
  message,
  sessionRole,
  sessionSelectedModel,
  sessionAgentColors,
}: AgentChatMessageCardProps): ReactElement | null {
  const timeLabel = formatTime(message.timestamp);
  const meta = message.meta;
  const isReasoningMessage = meta?.kind === "reasoning";
  const isUserMessage = message.role === "user";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage = meta?.kind === "tool" && isOdtWorkflowMutationToolName(meta.tool);
  const isRegularToolMessage = isToolMessage && !isWorkflowToolMessage;
  const isSubtaskMessage = meta?.kind === "subtask";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage = isToolMessage || isSubtaskMessage || isSystemPromptMessage;
  const assistantRole = assistantRoleFromMessage(message, sessionRole);
  const assistantAccentColor = resolveAssistantAgentColor(
    message,
    sessionSelectedModel,
    sessionAgentColors,
  );
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";

  return (
    <article
      className={toArticleClassName(
        message,
        isUserMessage,
        isToolMessage,
        isWorkflowToolMessage,
        isSubtaskMessage,
        isSystemPromptMessage,
      )}
    >
      <MessageHeader
        message={message}
        sessionRole={sessionRole}
        timeLabel={timeLabel}
        showHeader={!isUserMessage && !isRegularToolMessage && !isReasoningMessage}
        assistantRole={assistantRole}
        compactPadding={isRichCardMessage && !isRegularToolMessage}
      />

      <MessageBody
        message={message}
        sessionSelectedModel={sessionSelectedModel}
        assistantAccentColor={assistantAccentColor}
        timeLabel={timeLabel}
        systemPromptBody={systemPromptBody}
      />
    </article>
  );
}
