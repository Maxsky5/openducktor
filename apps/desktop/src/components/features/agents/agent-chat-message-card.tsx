import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  type AgentModelSelection,
  type AgentRole,
  isOdtWorkflowMutationToolName,
  toOdtWorkflowToolDisplayName,
} from "@openblueprint/core";
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
import { resolveAgentAccentColor } from "./agent-accent-color";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  sessionSelectedModel: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
};

const OUTPUT_IGNORED_TOOL_NAMES = new Set([
  "read",
  "glob",
  "grep",
  "find",
  "search",
  "list",
  "ls",
  "distill",
]);

const REGULAR_TOOL_SUMMARY_FROM_OUTPUT_TOOL_NAMES = new Set(["task", "subtask", "delegate"]);

const SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

const formatTime = (timestamp: string): string => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
};

const formatDuration = (durationMs: number): string => {
  if (durationMs < 1_000) {
    return `${Math.max(1, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs / 1_000)}s`;
};

const compactText = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const stripToolPrefix = (tool: string, value: string): string => {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = value.trim();
  return normalized
    .replace(new RegExp(`^Tool\\s+${escaped}\\s*`, "i"), "")
    .replace(/^(queued|running|completed|failed)\s*[:.-]?\s*/i, "")
    .trim();
};

const toolDisplayName = (tool: string): string => {
  return toOdtWorkflowToolDisplayName(tool);
};

const toSingleLineMarkdown = (value: string): string => {
  return value
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
};

const assistantRoleFromMessage = (
  message: AgentChatMessage,
  sessionRole: AgentRole | null,
): AgentRole | null => {
  if (message.role !== "assistant") {
    return null;
  }
  if (message.meta?.kind === "assistant") {
    return message.meta.agentRole;
  }
  return sessionRole;
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

const roleLabel = (
  role: AgentChatMessage["role"],
  sessionRole: AgentRole | null,
  message: AgentChatMessage,
): string => {
  if (role === "assistant") {
    const assistantRole = assistantRoleFromMessage(message, sessionRole);
    return assistantRole ? AGENT_ROLE_LABEL[assistantRole] : "Assistant";
  }
  if (role === "thinking") {
    return "Thinking";
  }
  if (role === "tool") {
    return "Activity";
  }
  return "System";
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

const hasNonEmptyInput = (input: Record<string, unknown> | undefined): boolean => {
  if (!input) {
    return false;
  }
  return Object.keys(input).length > 0;
};

const hasNonEmptyText = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const readInputString = (
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | null => {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const summarizeSearchToolInput = (
  tool: string,
  input: Record<string, unknown> | undefined,
): string | null => {
  if (!input) {
    return null;
  }
  const pattern = readInputString(input, [
    "pattern",
    "query",
    "regex",
    "glob",
    "expression",
    "name",
  ]);
  const path = readInputString(input, ["path", "cwd", "directory", "root", "basePath"]);
  const normalizedPath = path && path !== "." ? path : null;

  if (tool === "glob" && pattern && normalizedPath) {
    return `${pattern} in ${normalizedPath}`;
  }
  if ((tool === "glob" || tool === "grep" || tool === "find" || tool === "search") && pattern) {
    return normalizedPath ? `${pattern} in ${normalizedPath}` : pattern;
  }
  if (normalizedPath) {
    return normalizedPath;
  }
  if (path === ".") {
    return "workspace";
  }
  return null;
};

const extractPathFromInput = (input: Record<string, unknown> | undefined): string | null => {
  const candidate =
    input?.filePath ?? input?.file_path ?? input?.path ?? input?.file ?? input?.filename;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.trim();
  if (normalized.length === 0 || normalized === ".") {
    return null;
  }
  return normalized;
};

const getTaskSummary = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
): string | null => {
  const summary = meta.metadata?.summary;
  if (Array.isArray(summary)) {
    return `${summary.length} subagent tool step${summary.length === 1 ? "" : "s"}`;
  }
  const sessionId = meta.metadata?.sessionId;
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    return `Subagent session ${sessionId.slice(0, 8)}`;
  }
  return null;
};

const parseStructuredOutputSummary = (output: string): string | null => {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length > 0
        ? `${parsed.length} subagent result${parsed.length === 1 ? "" : "s"}`
        : null;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.summary)) {
      return `${record.summary.length} subagent result${record.summary.length === 1 ? "" : "s"}`;
    }

    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return compactText(record.message, 160);
    }

    if (typeof record.result === "string" && record.result.trim().length > 0) {
      return compactText(record.result, 160);
    }

    return null;
  } catch {
    return null;
  }
};

const buildToolSummary = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
  content: string,
): string => {
  const lowerTool = meta.tool.toLowerCase();

  if (lowerTool === "task") {
    const taskSummary = getTaskSummary(meta);
    if (taskSummary) {
      return taskSummary;
    }
  }

  if (meta.status === "error" && hasNonEmptyText(meta.error)) {
    return compactText(meta.error, 220);
  }

  if (meta.title && meta.title.trim().length > 0) {
    return compactText(meta.title, 160);
  }

  const path = extractPathFromInput(meta.input);
  const searchSummary = summarizeSearchToolInput(lowerTool, meta.input);
  if (searchSummary) {
    return compactText(searchSummary, 160);
  }
  if (path && lowerTool !== "glob" && lowerTool !== "grep") {
    return compactText(path, 160);
  }

  const command = meta.input?.command;
  if (lowerTool === "bash" && typeof command === "string" && command.trim().length > 0) {
    return compactText(command, 120);
  }

  if (!OUTPUT_IGNORED_TOOL_NAMES.has(lowerTool) && hasNonEmptyText(meta.output)) {
    if (REGULAR_TOOL_SUMMARY_FROM_OUTPUT_TOOL_NAMES.has(lowerTool)) {
      const structured = parseStructuredOutputSummary(meta.output);
      if (structured) {
        return structured;
      }
    }
    return compactText(meta.output, 160);
  }

  const fromContent = stripToolPrefix(meta.tool, content);
  if (fromContent.length > 0) {
    return compactText(fromContent, 160);
  }

  return "";
};

const getToolDuration = (
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>,
  messageTimestamp: string,
): number | null => {
  if (typeof meta.startedAtMs !== "number") {
    return null;
  }
  const endedAtMs =
    typeof meta.endedAtMs === "number"
      ? meta.endedAtMs
      : meta.status === "running" || meta.status === "pending"
        ? null
        : Date.parse(messageTimestamp);
  if (endedAtMs === null || Number.isNaN(endedAtMs) || endedAtMs < meta.startedAtMs) {
    return null;
  }
  return endedAtMs - meta.startedAtMs;
};

const getAssistantFooterParts = (
  message: AgentChatMessage,
  sessionSelectedModel: AgentModelSelection | null,
): string[] => {
  if (message.role !== "assistant") {
    return [];
  }

  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const parts: string[] = [];

  const agentLabel = assistantMeta?.opencodeAgent ?? sessionSelectedModel?.opencodeAgent;
  if (typeof agentLabel === "string" && agentLabel.trim().length > 0) {
    parts.push(agentLabel.trim());
  }

  const modelLabel = assistantMeta?.modelId ?? sessionSelectedModel?.modelId;
  if (typeof modelLabel === "string" && modelLabel.trim().length > 0) {
    parts.push(modelLabel.trim());
  }

  if (assistantMeta?.durationMs && assistantMeta.durationMs > 0) {
    parts.push(formatDuration(assistantMeta.durationMs));
  }

  return parts;
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
      className={cn(
        "text-sm",
        isUserMessage &&
          "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm border border-sky-100 bg-sky-50 px-4 py-3 text-slate-900 shadow-sm",
        isToolMessage
          ? isWorkflowToolMessage
            ? meta.status === "completed"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
              : meta.status === "error"
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
      )}
    >
      {!isUserMessage ? (
        <header
          className={cn(
            "mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
            message.role === "assistant" ? "mb-2" : "mb-1",
            isRichCardMessage && !isRegularToolMessage ? "" : "px-1",
          )}
        >
          {isRegularToolMessage || isReasoningMessage ? null : (
            <>
              <span className="inline-flex items-center gap-1">
                {message.role === "thinking" ? <Brain className="size-3" /> : null}
                {message.role === "tool" ? <Hammer className="size-3" /> : null}
                {message.role === "assistant" && assistantRole
                  ? assistantRoleIcon(assistantRole)
                  : null}
                {roleLabel(message.role, sessionRole, message)}
              </span>
              {timeLabel ? <span className="font-normal normal-case">{timeLabel}</span> : null}
            </>
          )}
        </header>
      ) : null}

      {meta?.kind === "reasoning" ? (
        meta.completed ? (
          <details className="px-1 py-0.5">
            <summary className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-slate-700">
              <Brain className="size-3.5 shrink-0 text-slate-500" />
              <span className="shrink-0 font-medium text-slate-500">Thinking</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">
                {toSingleLineMarkdown(message.content || "Reasoning complete")}
              </span>
              {timeLabel ? (
                <span className="shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
              ) : null}
            </summary>
            <div className="pl-6 pt-2">
              <MarkdownRenderer
                markdown={message.content || "Reasoning complete"}
                variant="compact"
              />
            </div>
          </details>
        ) : (
          <div className="space-y-1 px-1 py-0.5 text-xs text-slate-700">
            <div className="flex min-h-6 items-center gap-2">
              <Brain className="size-3.5 shrink-0 text-slate-500" />
              <span className="shrink-0 font-medium text-slate-500">Thinking</span>
              {timeLabel ? (
                <span className="ml-auto shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
              ) : null}
            </div>
            <MarkdownRenderer markdown={message.content || "Thinking..."} variant="compact" />
          </div>
        )
      ) : meta?.kind === "tool" ? (
        (() => {
          const isWorkflowTool = isOdtWorkflowMutationToolName(meta.tool);
          const summary = buildToolSummary(meta, message.content);
          const durationMs = getToolDuration(meta, message.timestamp);
          const hasInput = hasNonEmptyInput(meta.input);
          const hasOutput = hasNonEmptyText(meta.output);
          const hasError = hasNonEmptyText(meta.error);
          const isRunning = meta.status === "running" || meta.status === "pending";

          if (!isWorkflowTool) {
            const summaryText =
              summary.length > 0 ? summary : meta.status === "error" ? "Tool failed" : "";
            return (
              <div
                className={cn(
                  "flex min-h-6 items-center gap-2 px-1 py-0.5 text-xs",
                  meta.status === "error" ? "text-rose-700" : "text-slate-700",
                )}
              >
                <span className={cn(meta.status === "error" ? "text-rose-500" : "text-slate-500")}>
                  {toolIcon(meta.tool)}
                </span>
                <p className="shrink-0 font-medium text-current">{toolDisplayName(meta.tool)}</p>
                {summaryText.length > 0 ? (
                  <p className="truncate text-slate-600">{summaryText}</p>
                ) : null}
                <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  {isRunning ? <LoaderCircle className="size-3 animate-spin" /> : null}
                  {!isRunning && durationMs !== null ? (
                    <span>{formatDuration(durationMs)}</span>
                  ) : null}
                  {timeLabel ? <span>{timeLabel}</span> : null}
                </span>
              </div>
            );
          }

          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span>{toolIcon(meta.tool)}</span>
                <p
                  className={cn(
                    "truncate text-xs font-semibold",
                    meta.status === "error"
                      ? "text-rose-900"
                      : meta.status === "completed"
                        ? "text-emerald-900"
                        : "text-amber-900",
                  )}
                >
                  {toolDisplayName(meta.tool)}
                </p>
                {summary.length > 0 ? (
                  <p className="truncate text-xs text-current/80">{summary}</p>
                ) : null}
                {isRunning ? <LoaderCircle className="ml-auto size-3 animate-spin" /> : null}
                {!isRunning && durationMs !== null ? (
                  <span className="ml-auto text-[11px] text-current/75">
                    {formatDuration(durationMs)}
                  </span>
                ) : null}
              </div>
              {(hasInput || hasOutput || hasError) && (
                <details className="rounded border border-current/20 bg-white/55">
                  <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-current">
                    Details
                  </summary>
                  <div className="space-y-2 px-2 pb-2">
                    {hasInput && meta.input ? (
                      <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-current">
                        {JSON.stringify(meta.input, null, 2)}
                      </pre>
                    ) : null}
                    {hasOutput && meta.output ? (
                      <MarkdownRenderer markdown={meta.output} variant="compact" />
                    ) : null}
                    {hasError && meta.error ? (
                      <MarkdownRenderer markdown={meta.error} variant="compact" />
                    ) : null}
                  </div>
                </details>
              )}
            </div>
          );
        })()
      ) : meta?.kind === "subtask" ? (
        <div className="flex min-h-6 items-center gap-2 px-1 py-0.5 text-xs text-violet-700">
          <MessageSquareQuote className="size-3.5 shrink-0 text-violet-500" />
          <p className="shrink-0 font-medium">subagent {meta.agent}</p>
          <p className="truncate text-violet-700/90">{meta.description}</p>
          {timeLabel ? (
            <span className="ml-auto shrink-0 text-[11px] text-slate-500">{timeLabel}</span>
          ) : null}
        </div>
      ) : isSystemPromptMessage ? (
        <details className="rounded border border-slate-200 bg-slate-50/70">
          <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-700">
            Show system prompt
          </summary>
          <div className="border-t border-slate-200 px-2 py-2">
            <MarkdownRenderer markdown={systemPromptBody} variant="compact" />
          </div>
        </details>
      ) : message.role === "user" ? (
        <>
          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
          {timeLabel ? (
            <p className="mt-2 text-right text-[11px] font-medium text-slate-500">{timeLabel}</p>
          ) : null}
        </>
      ) : message.role === "thinking" || message.role === "system" ? (
        <p className="whitespace-pre-wrap leading-6 text-slate-700">{message.content}</p>
      ) : message.role === "assistant" ? (
        <div className="space-y-2">
          <MarkdownRenderer markdown={message.content} variant="document" />
          {(() => {
            const footerParts = getAssistantFooterParts(message, sessionSelectedModel);
            if (footerParts.length === 0) {
              return null;
            }
            return (
              <p className="inline-flex items-center gap-2 text-xs text-slate-500">
                <span
                  className="size-1.5 rounded-sm bg-amber-500"
                  style={
                    assistantAccentColor ? { backgroundColor: assistantAccentColor } : undefined
                  }
                />
                {footerParts.join(" · ")}
              </p>
            );
          })()}
        </div>
      ) : (
        <MarkdownRenderer markdown={message.content} variant="document" />
      )}
    </article>
  );
}
