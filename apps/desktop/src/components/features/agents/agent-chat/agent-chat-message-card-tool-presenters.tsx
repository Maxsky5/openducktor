import type { AgentRole } from "@openducktor/core";
import {
  Bot,
  FileText,
  Folder,
  Globe,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  buildToolSummary,
  formatRawJsonLikeText,
  getToolDuration,
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
  questionToolDetails,
  toolDisplayName,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-types";
import { formatAgentDuration } from "./format-agent-duration";

export const assistantRoleIcon = (role: AgentRole): ReactElement => {
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

export const WorkflowToolMessage = ({
  meta,
  messageTimestamp,
}: WorkflowToolMessageProps): ReactElement => {
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isActive = lifecyclePhase === "queued" || lifecyclePhase === "executing";
  const isFailure = lifecyclePhase === "failed";
  const isCancelled = lifecyclePhase === "cancelled";
  const isSuccessfulCompletion = lifecyclePhase === "completed";
  const isExecuting = lifecyclePhase === "executing";
  const statusLabel =
    lifecyclePhase === "queued" ? "QUEUED" : lifecyclePhase === "executing" ? "RUNNING" : null;
  const statusClassName = isExecuting
    ? "border-blue-300/70 dark:border-blue-700/70 bg-blue-100/80 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200"
    : "border-violet-300/70 dark:border-violet-700/70 bg-violet-100/80 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span>{toolIcon(meta.tool)}</span>
        <p
          className={cn(
            "text-xs font-semibold",
            isFailure
              ? "text-rose-900 dark:text-rose-200"
              : isCancelled
                ? "text-orange-900 dark:text-orange-200"
                : isSuccessfulCompletion
                  ? "text-emerald-900 dark:text-emerald-200"
                  : isExecuting
                    ? "text-blue-900 dark:text-blue-200"
                    : "text-violet-900 dark:text-violet-200",
          )}
        >
          {toolDisplayName(meta.tool)}
        </p>
        {statusLabel ? (
          <span
            className={cn(
              "ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
              statusClassName,
            )}
          >
            {statusLabel}
          </span>
        ) : null}
        {isExecuting ? <LoaderCircle className="size-3 animate-spin" /> : null}
        {!isActive && durationMs !== null ? (
          <span className="ml-auto text-[11px] text-current/75">
            {formatAgentDuration(durationMs)}
          </span>
        ) : null}
      </div>
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <details className="rounded border border-current/20 bg-card">
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
              className="rounded border border-current/20 bg-card"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
            />
          ) : null}
          {hasError && meta.error ? (
            <ToolJsonDetails
              label="Error"
              value={meta.error}
              className="rounded border border-current/20 bg-muted/90"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

type RegularToolMessageProps = {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
};

export const RegularToolMessage = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
}: RegularToolMessageProps): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const summary = buildToolSummary(meta, messageContent);
  const summaryText =
    summary.length > 0
      ? summary
      : lifecyclePhase === "failed"
        ? "Tool failed"
        : lifecyclePhase === "cancelled"
          ? "Tool cancelled"
          : "";
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const hasExpandableDetails = hasInput || hasOutput || hasError;
  const isActive = lifecyclePhase === "queued" || lifecyclePhase === "executing";
  const questionDetails = questionToolDetails(meta);

  const summaryRow = (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 text-xs",
        hasExpandableDetails ? "cursor-pointer" : "",
        lifecyclePhase === "failed"
          ? "text-rose-700 dark:text-rose-300"
          : lifecyclePhase === "cancelled"
            ? "text-orange-700 dark:text-orange-300"
            : "text-foreground",
      )}
    >
      <span
        className={cn(
          lifecyclePhase === "failed"
            ? "text-rose-500"
            : lifecyclePhase === "cancelled"
              ? "text-orange-500"
              : "text-muted-foreground",
        )}
      >
        {toolIcon(meta.tool)}
      </span>
      <p className="shrink-0 font-medium text-current">{toolDisplayName(meta.tool)}</p>
      {summaryText.length > 0 ? (
        <p className="truncate text-muted-foreground">{summaryText}</p>
      ) : null}
      <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
        {isActive ? <LoaderCircle className="size-3 animate-spin" /> : null}
        {!isActive && durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
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
              <details className="rounded border border-border bg-card">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
                  Input
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-foreground">
                  {JSON.stringify(meta.input, null, 2)}
                </pre>
              </details>
            ) : null}
            {hasOutput && meta.output ? (
              <details className="rounded border border-border bg-card">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
                  Output
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-foreground">
                  {formatRawJsonLikeText(meta.output)}
                </pre>
              </details>
            ) : null}
            {hasError && meta.error ? (
              <details className="rounded border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/40">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                  Error
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-rose-700 dark:text-rose-300">
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
        <details className="ml-5 rounded border border-border bg-muted/90">
          <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-foreground">
            Questions and answers
          </summary>
          <div className="space-y-2 border-t border-border px-2 py-2 text-xs text-foreground">
            {questionDetails.map((entry, index) => (
              <div key={`${meta.callId}:question:${index}`} className="space-y-0.5">
                <p className="font-medium text-foreground">{entry.prompt}</p>
                <p
                  className={cn(
                    "whitespace-pre-wrap",
                    entry.answers.length > 0 ? "text-foreground" : "italic text-muted-foreground",
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
