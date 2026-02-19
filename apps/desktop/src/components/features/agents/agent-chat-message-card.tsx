import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  Brain,
  FileText,
  Folder,
  Globe,
  Hammer,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
};

const WORKFLOW_TOOL_NAMES = new Set([
  "set_spec",
  "set_plan",
  "build_blocked",
  "build_resumed",
  "build_completed",
  "qa_approved",
  "qa_rejected",
]);

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

const statusBadgeVariant = (
  status: "pending" | "running" | "completed" | "error",
): "default" | "warning" | "success" | "danger" => {
  if (status === "error") {
    return "danger";
  }
  if (status === "completed") {
    return "success";
  }
  if (status === "running") {
    return "warning";
  }
  return "default";
};

const toolBadgeVariant = (
  status: "pending" | "running" | "completed" | "error",
  isWorkflowTool: boolean,
): "default" | "warning" | "success" | "danger" => {
  if (!isWorkflowTool && status === "completed") {
    return "default";
  }
  return statusBadgeVariant(status);
};

const roleLabel = (role: AgentChatMessage["role"]): string => {
  if (role === "assistant") {
    return "Assistant";
  }
  if (role === "thinking") {
    return "Thinking";
  }
  if (role === "tool") {
    return "Activity";
  }
  return "System";
};

const SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

const hasNonEmptyInput = (input: Record<string, unknown> | undefined): boolean => {
  if (!input) {
    return false;
  }
  return Object.keys(input).length > 0;
};

const hasNonEmptyText = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const compactText = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
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

const toToolSummary = (input: {
  tool: string;
  title?: string;
  content: string;
  args?: Record<string, unknown>;
}): string => {
  if (input.tool === "read") {
    const pathCandidate =
      input.args?.filePath ??
      input.args?.file_path ??
      input.args?.path ??
      input.args?.file ??
      input.args?.filename;
    if (typeof pathCandidate === "string" && pathCandidate.trim().length > 0) {
      return pathCandidate;
    }
  }

  if (input.tool === "bash") {
    const command = input.args?.command;
    if (typeof command === "string" && command.trim().length > 0) {
      return compactText(command, 120);
    }
  }

  if (input.title && input.title.trim().length > 0) {
    return input.title.trim();
  }

  return compactText(input.content, 120);
};

export function AgentChatMessageCard({ message }: AgentChatMessageCardProps): ReactElement {
  const timeLabel = formatTime(message.timestamp);
  const meta = message.meta;
  const isUserMessage = message.role === "user";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage =
    meta?.kind === "tool" && WORKFLOW_TOOL_NAMES.has(meta.tool.toLowerCase());
  const isSubtaskMessage = meta?.kind === "subtask";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage = isToolMessage || isSubtaskMessage || isSystemPromptMessage;
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
              : isUserMessage
                ? ""
                : "border-none bg-transparent px-0 py-0 text-slate-800",
      )}
    >
      {!isUserMessage ? (
        <header
          className={cn(
            "mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
            isRichCardMessage ? "" : "px-1",
          )}
        >
          <span className="inline-flex items-center gap-1">
            {message.role === "thinking" ? <Brain className="size-3" /> : null}
            {message.role === "tool" ? <Hammer className="size-3" /> : null}
            {roleLabel(message.role)}
          </span>
          {timeLabel ? <span className="font-normal normal-case">{timeLabel}</span> : null}
        </header>
      ) : null}

      {meta?.kind === "reasoning" ? (
        <p className="whitespace-pre-wrap leading-6 text-slate-700">
          {message.content || "Thinking..."}
        </p>
      ) : meta?.kind === "tool" ? (
        <div className="space-y-2">
          {(() => {
            const isWorkflowTool = WORKFLOW_TOOL_NAMES.has(meta.tool.toLowerCase());
            const hasInput = hasNonEmptyInput(meta.input);
            const hasOutput = hasNonEmptyText(meta.output);
            const hasError = hasNonEmptyText(meta.error);
            const summary = toToolSummary({
              tool: meta.tool,
              content: message.content,
              ...(meta.title ? { title: meta.title } : {}),
              ...(meta.input ? { args: meta.input } : {}),
            });

            return (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={toolBadgeVariant(meta.status, isWorkflowTool)}>
                    {meta.status}
                  </Badge>
                  <p
                    className={cn(
                      "truncate text-xs font-semibold",
                      isWorkflowTool
                        ? meta.status === "error"
                          ? "text-rose-900"
                          : meta.status === "completed"
                            ? "text-emerald-900"
                            : "text-amber-900"
                        : "text-slate-800",
                    )}
                  >
                    {meta.tool}
                  </p>
                  {meta.status === "running" ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : null}
                </div>

                {!isWorkflowTool ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                      <span className="text-slate-500">{toolIcon(meta.tool)}</span>
                      <p className="truncate text-xs font-medium text-slate-800">{meta.tool}</p>
                      {summary.length > 0 ? (
                        <p className="truncate text-xs text-slate-600">{summary}</p>
                      ) : null}
                      {meta.status === "running" ? (
                        <LoaderCircle className="ml-auto size-3 animate-spin text-slate-500" />
                      ) : null}
                    </div>
                    {hasError && meta.error ? (
                      <p className="text-xs text-rose-700">{compactText(meta.error)}</p>
                    ) : null}
                    {(hasInput || hasOutput || hasError) &&
                    (meta.status === "completed" || meta.status === "error") ? (
                      <details className="rounded border border-slate-200 bg-slate-50/70">
                        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-700">
                          Details
                        </summary>
                        <div className="space-y-2 px-2 pb-2">
                          {hasInput && meta.input ? (
                            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-700">
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
                    ) : null}
                  </div>
                ) : (
                  <>
                    {hasInput && meta.input ? (
                      <details className="rounded border border-emerald-200 bg-white/60">
                        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-emerald-900">
                          Input
                        </summary>
                        <pre className="overflow-x-auto px-2 pb-2 text-[11px] text-emerald-900">
                          {JSON.stringify(meta.input, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    {hasOutput && meta.output ? (
                      <details open className="rounded border border-emerald-200 bg-white/60">
                        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-emerald-900">
                          Output
                        </summary>
                        <div className="px-2 pb-2">
                          <MarkdownRenderer markdown={meta.output} variant="compact" />
                        </div>
                      </details>
                    ) : null}
                    {hasError && meta.error ? (
                      <details open className="rounded border border-rose-300 bg-rose-100/40">
                        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-rose-800">
                          Error
                        </summary>
                        <div className="px-2 pb-2">
                          <MarkdownRenderer markdown={meta.error} variant="compact" />
                        </div>
                      </details>
                    ) : null}
                    {!hasOutput && !hasError && message.content ? (
                      <MarkdownRenderer markdown={message.content} variant="compact" />
                    ) : null}
                  </>
                )}
              </>
            );
          })()}
        </div>
      ) : meta?.kind === "step" ? (
        <div className="space-y-1 text-xs text-slate-600">
          <p className="font-medium text-slate-700">
            {meta.phase === "start" ? "Step started" : "Step finished"}
            {typeof meta.cost === "number" ? ` · cost ${meta.cost.toFixed(2)}` : ""}
          </p>
          {meta.reason ? <p>{meta.reason}</p> : null}
        </div>
      ) : meta?.kind === "subtask" ? (
        <div className="space-y-1 rounded border border-amber-200 bg-amber-100/40 p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            Subtask · {meta.agent}
          </p>
          <p className="text-xs text-amber-900">{meta.description}</p>
          {meta.prompt ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-amber-900">
                Prompt
              </summary>
              <p className="whitespace-pre-wrap text-xs text-amber-900">{meta.prompt}</p>
            </details>
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
        <MarkdownRenderer markdown={message.content} variant="compact" />
      ) : (
        <MarkdownRenderer markdown={message.content} variant="compact" />
      )}
    </article>
  );
}
