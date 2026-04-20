import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  Bot,
  FileText,
  Folder,
  Globe,
  ListTodo,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { isTodoToolName } from "@/state/operations/agent-orchestrator/agent-tool-messages";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import {
  buildToolSummary,
  extractAllFileEditData,
  formatRawJsonLikeText,
  getToolDuration,
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
  isFileEditTool,
  type QuestionToolDetail,
  questionToolDetails,
  toolDisplayName,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { formatAgentDuration } from "./format-agent-duration";
import { SubagentTranscriptButton } from "./subagent-transcript-button";
import { relativizeDisplayPathsInValue } from "./tool-path-utils";

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
  if (isTodoToolName(value)) {
    return <ListTodo className="size-3.5" />;
  }
  return <Wrench className="size-3.5" />;
};

const buildQuestionDetailRenderEntries = (
  callId: string,
  questionDetails: QuestionToolDetail[],
): Array<{ key: string; detail: QuestionToolDetail }> => {
  const countsByBaseKey = new Map<string, number>();

  return questionDetails.map((detail) => {
    const baseKey = `${callId}:question:${detail.prompt}:${detail.answers.join("|")}`;
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);
    return {
      key: `${baseKey}:${nextCount}`,
      detail,
    };
  });
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

const formatToolInput = (
  input: Record<string, unknown>,
  workingDirectory?: string | null,
): string => {
  return JSON.stringify(relativizeDisplayPathsInValue(input, workingDirectory), null, 2);
};

type WorkflowToolMessageProps = {
  meta: ToolMeta;
  taskId?: string | null;
  sessionRole?: AgentRole | null;
  sessionRuntimeKind?: RuntimeKind | null;
  messageTimestamp: string;
  sessionWorkingDirectory?: string | null | undefined;
  workflowToolAliasesByCanonical?: RuntimeDescriptor["workflowToolAliasesByCanonical"] | undefined;
};

export const WorkflowToolMessage = ({
  meta,
  taskId,
  sessionRole,
  sessionRuntimeKind,
  messageTimestamp,
  sessionWorkingDirectory,
  workflowToolAliasesByCanonical,
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
    ? "border-info-border bg-info-surface text-info-surface-foreground"
    : "border-pending-border bg-pending-surface text-pending-surface-foreground";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span>{toolIcon(meta.tool)}</span>
        <p
          className={cn(
            "text-xs font-semibold",
            isFailure
              ? "text-destructive-surface-foreground"
              : isCancelled
                ? "text-cancelled-surface-foreground"
                : isSuccessfulCompletion
                  ? "text-success-surface-foreground"
                  : isExecuting
                    ? "text-info-surface-foreground"
                    : "text-pending-surface-foreground",
          )}
        >
          {toolDisplayName(meta.tool, workflowToolAliasesByCanonical)}
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
        <SubagentTranscriptButton
          taskId={taskId ?? null}
          sessionRole={sessionRole ?? null}
          sessionRuntimeKind={sessionRuntimeKind ?? null}
          sessionWorkingDirectory={sessionWorkingDirectory}
          meta={meta}
        />
      </div>
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <details className="rounded border border-current/20 bg-card">
              <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-current">
                Input
              </summary>
              <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-current">
                {formatToolInput(meta.input, sessionWorkingDirectory)}
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
  taskId?: string | null;
  sessionRole?: AgentRole | null;
  sessionRuntimeKind?: RuntimeKind | null;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  workflowToolAliasesByCanonical?: RuntimeDescriptor["workflowToolAliasesByCanonical"] | undefined;
};

export const RegularToolMessage = ({
  meta,
  taskId,
  sessionRole,
  sessionRuntimeKind,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  workflowToolAliasesByCanonical,
}: RegularToolMessageProps): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const summary = buildToolSummary(meta, messageContent, sessionWorkingDirectory);
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
  const questionDetailRenderEntries = buildQuestionDetailRenderEntries(
    meta.callId,
    questionDetails,
  );

  const summaryRow = (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 text-xs",
        hasExpandableDetails ? "cursor-pointer" : "",
        lifecyclePhase === "failed"
          ? "text-destructive-muted"
          : lifecyclePhase === "cancelled"
            ? "text-cancelled-muted"
            : "text-foreground",
      )}
    >
      <span
        className={cn(
          lifecyclePhase === "failed"
            ? "text-destructive-accent"
            : lifecyclePhase === "cancelled"
              ? "text-cancelled-accent"
              : "text-muted-foreground",
        )}
      >
        {toolIcon(meta.tool)}
      </span>
      <p className="shrink-0 font-medium text-current">
        {toolDisplayName(meta.tool, workflowToolAliasesByCanonical)}
      </p>
      {summaryText.length > 0 ? (
        <p className="truncate text-muted-foreground">{summaryText}</p>
      ) : null}
      <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
        <SubagentTranscriptButton
          taskId={taskId ?? null}
          sessionRole={sessionRole ?? null}
          sessionRuntimeKind={sessionRuntimeKind ?? null}
          sessionWorkingDirectory={sessionWorkingDirectory}
          meta={meta}
        />
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
                  {formatToolInput(meta.input, sessionWorkingDirectory)}
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
              <details className="rounded border border-destructive-border bg-destructive-surface">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-destructive-muted">
                  Error
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-destructive-muted">
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
            {questionDetailRenderEntries.map(({ key, detail }) => (
              <div key={key} className="space-y-0.5">
                <p className="font-medium text-foreground">{detail.prompt}</p>
                <p
                  className={cn(
                    "whitespace-pre-wrap",
                    detail.answers.length > 0 ? "text-foreground" : "italic text-muted-foreground",
                  )}
                >
                  {detail.answers.length > 0 ? detail.answers.join(", ") : "No answer yet"}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {isFileEditTool(meta.tool) &&
        (() => {
          const allFileEditData = extractAllFileEditData(meta, sessionWorkingDirectory);
          return allFileEditData.length > 0
            ? allFileEditData.map((data) => (
                <AgentChatFileEditCard key={data.filePath} data={data} />
              ))
            : null;
        })()}
    </div>
  );
};
