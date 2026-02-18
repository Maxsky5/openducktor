import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { Bot, Brain, Hammer, LoaderCircle, User } from "lucide-react";
import type { ReactElement } from "react";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
};

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

const roleLabel = (role: AgentChatMessage["role"]): string => {
  if (role === "user") {
    return "User";
  }
  if (role === "assistant") {
    return "Assistant";
  }
  if (role === "thinking") {
    return "Thinking";
  }
  if (role === "tool") {
    return "Tool";
  }
  return "System";
};

export function AgentChatMessageCard({ message }: AgentChatMessageCardProps): ReactElement {
  const timeLabel = formatTime(message.timestamp);
  const meta = message.meta;

  return (
    <article
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        message.role === "user"
          ? "border-sky-200 bg-sky-50 text-slate-800"
          : message.role === "assistant"
            ? "border-slate-200 bg-white text-slate-800"
            : message.role === "thinking"
              ? "border-violet-200 bg-violet-50 text-violet-900"
              : message.role === "tool"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <header className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span className="inline-flex items-center gap-1">
          {message.role === "user" ? (
            <User className="size-3" />
          ) : message.role === "assistant" ? (
            <Bot className="size-3" />
          ) : message.role === "thinking" ? (
            <Brain className="size-3" />
          ) : message.role === "tool" ? (
            <Hammer className="size-3" />
          ) : null}
          {roleLabel(message.role)}
        </span>
        {timeLabel ? <span className="font-normal normal-case">{timeLabel}</span> : null}
      </header>

      {meta?.kind === "reasoning" ? (
        <details
          open={!meta.completed}
          className="rounded border border-violet-200 bg-violet-100/40"
        >
          <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-violet-900">
            Reasoning trace
          </summary>
          <div className="px-2 pb-2">
            <MarkdownRenderer markdown={message.content} variant="compact" />
          </div>
        </details>
      ) : meta?.kind === "tool" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant(meta.status)}>{meta.status}</Badge>
            <p className="truncate text-xs font-semibold text-emerald-900">{meta.tool}</p>
            {meta.title ? <p className="truncate text-xs text-emerald-700">{meta.title}</p> : null}
            {meta.status === "running" ? <LoaderCircle className="size-3 animate-spin" /> : null}
          </div>
          {meta.input ? (
            <details className="rounded border border-emerald-200 bg-white/60">
              <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-emerald-900">
                Input
              </summary>
              <pre className="overflow-x-auto px-2 pb-2 text-[11px] text-emerald-900">
                {JSON.stringify(meta.input, null, 2)}
              </pre>
            </details>
          ) : null}
          {meta.output ? (
            <details open className="rounded border border-emerald-200 bg-white/60">
              <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-emerald-900">
                Output
              </summary>
              <div className="px-2 pb-2">
                <MarkdownRenderer markdown={meta.output} variant="compact" />
              </div>
            </details>
          ) : null}
          {meta.error ? (
            <details open className="rounded border border-rose-300 bg-rose-100/40">
              <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-rose-800">
                Error
              </summary>
              <div className="px-2 pb-2">
                <MarkdownRenderer markdown={meta.error} variant="compact" />
              </div>
            </details>
          ) : null}
          {!meta.output && !meta.error && message.content ? (
            <MarkdownRenderer markdown={message.content} variant="compact" />
          ) : null}
        </div>
      ) : meta?.kind === "step" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={meta.phase === "start" ? "warning" : "success"}>
              {meta.phase === "start" ? "step started" : "step finished"}
            </Badge>
            {typeof meta.cost === "number" ? (
              <p className="text-xs text-amber-800">cost: {meta.cost.toFixed(2)}</p>
            ) : null}
          </div>
          {meta.reason ? <p className="text-xs text-amber-900">{meta.reason}</p> : null}
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
      ) : message.role === "user" ? (
        <p className="whitespace-pre-wrap">{message.content}</p>
      ) : (
        <MarkdownRenderer markdown={message.content} variant="compact" />
      )}
    </article>
  );
}
