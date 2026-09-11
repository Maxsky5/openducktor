import {
  FileText,
  Folder,
  Globe,
  ListTodo,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import type { AgentToolData } from "@openducktor/contracts";
import { cn } from "@/lib/utils";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import {
  buildToolSummary,
  extractAllFileEditData,
  formatRawJsonLikeText,
  getToolDuration,
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
  type QuestionToolDetail,
  questionToolDetails,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";
import { formatAgentDuration } from "./format-agent-duration";
import { relativizeDisplayPathsInValue } from "./tool-path-utils";

const toolIcon = (meta: Pick<ToolMeta, "tool" | "toolType">): ReactElement => {
  const value = meta.toolType;
  if (value === "read") {
    return <FileText className="size-3.5" />;
  }
  if (value === "bash") {
    return <Terminal className="size-3.5" />;
  }
  if (value === "list") {
    return <Folder className="size-3.5" />;
  }
  if (value === "search") {
    return <Search className="size-3.5" />;
  }
  if (value === "web") {
    return <Globe className="size-3.5" />;
  }
  if (value === "todo") {
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
  open?: boolean;
};

const ToolJsonDetails = ({
  label,
  value,
  className,
  titleClassName,
  open,
}: ToolJsonDetailsProps): ReactElement => {
  return (
    <details className={className} open={open}>
      <summary className={titleClassName}>{label}</summary>
      <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]">
        {formatRawJsonLikeText(value)}
      </pre>
    </details>
  );
};

const formatToolInput = (input: AgentToolData, workingDirectory?: string | null): string => {
  return JSON.stringify(relativizeDisplayPathsInValue(input, workingDirectory), null, 2);
};

type ToolInputDetailsProps = {
  input: AgentToolData;
  workingDirectory?: string | null | undefined;
  className: string;
  textClassName: string;
  visible?: boolean;
};

const ToolInputDetails = ({
  input,
  workingDirectory,
  className,
  textClassName,
  visible = true,
}: ToolInputDetailsProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const formatted = useMemo(
    () => (isOpen && visible ? formatToolInput(input, workingDirectory) : null),
    [input, workingDirectory, isOpen, visible],
  );
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={cn("cursor-pointer px-2 py-1 text-xs font-medium", textClassName)}>
        Input
      </summary>
      {formatted !== null ? (
        <pre
          className={cn("overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]", textClassName)}
        >
          {formatted}
        </pre>
      ) : null}
    </details>
  );
};

const ToolMessageTiming = ({
  showSpinner,
  durationMs,
  timeLabel,
  className,
}: {
  showSpinner: boolean;
  durationMs: number | null;
  timeLabel: string;
  className: string;
}): ReactElement => (
  <span className={cn("ml-auto inline-flex shrink-0 items-center gap-2 text-[11px]", className)}>
    {showSpinner ? <LoaderCircle className="size-3 animate-spin" /> : null}
    {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
    {timeLabel ? <span>{timeLabel}</span> : null}
  </span>
);

const WORKFLOW_TOOL_APPEARANCE = {
  queued: {
    label: "QUEUED",
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-pending-surface-foreground",
  },
  executing: {
    label: "RUNNING",
    statusClassName: "border-info-border bg-info-surface text-info-surface-foreground",
    foregroundClassName: "text-info-surface-foreground",
  },
  failed: {
    label: "FAILED",
    statusClassName:
      "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
    foregroundClassName: "text-destructive-surface-foreground",
  },
  cancelled: {
    label: "CANCELLED",
    statusClassName:
      "border-cancelled-border bg-cancelled-surface text-cancelled-surface-foreground",
    foregroundClassName: "text-cancelled-surface-foreground",
  },
  completed: {
    label: null,
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-success-surface-foreground",
  },
} satisfies Record<
  ReturnType<typeof getToolLifecyclePhase>,
  {
    label: string | null;
    statusClassName: string;
    foregroundClassName: string;
  }
>;

type WorkflowToolMessageProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

export const WorkflowToolMessage = ({
  meta,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: WorkflowToolMessageProps): ReactElement => {
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isFailure = lifecyclePhase === "failed";
  const isExecuting = lifecyclePhase === "executing";
  const {
    label: statusLabel,
    statusClassName,
    foregroundClassName,
  } = WORKFLOW_TOOL_APPEARANCE[lifecyclePhase];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={foregroundClassName}>{toolIcon(meta)}</span>
        <p className={cn("text-[11px] font-semibold", foregroundClassName)}>{displayName}</p>
        {statusLabel ? (
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusClassName,
            )}
          >
            {statusLabel}
          </span>
        ) : null}
        <ToolMessageTiming
          showSpinner={isExecuting}
          durationMs={durationMs}
          timeLabel={timeLabel}
          className="text-current/75 font-normal normal-case"
        />
      </div>
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <ToolInputDetails
              input={meta.input}
              workingDirectory={sessionWorkingDirectory}
              className="rounded border border-current/20 bg-card"
              textClassName="text-current"
            />
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
              open={isFailure}
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
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

const RegularToolSummary = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
  hasExpandableDetails,
}: RegularToolMessageProps & { hasExpandableDetails: boolean }): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isActive = lifecyclePhase === "queued" || lifecyclePhase === "executing";
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
  return (
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
        {toolIcon(meta)}
      </span>
      <p className="shrink-0 font-medium text-current">{displayName}</p>
      {summaryText.length > 0 ? (
        <p className="truncate text-muted-foreground">{summaryText}</p>
      ) : null}
      <ToolMessageTiming
        showSpinner={isActive}
        durationMs={durationMs}
        timeLabel={timeLabel}
        className="text-muted-foreground"
      />
    </div>
  );
};

export const RegularToolMessage = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: RegularToolMessageProps): ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const hasExpandableDetails = hasInput || hasOutput || hasError;
  const questionDetails = questionToolDetails(meta);
  const questionDetailRenderEntries = buildQuestionDetailRenderEntries(
    meta.callId,
    questionDetails,
  );

  const summaryRow = (
    <RegularToolSummary
      meta={meta}
      messageContent={messageContent}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      sessionWorkingDirectory={sessionWorkingDirectory}
      displayName={displayName}
      hasExpandableDetails={hasExpandableDetails}
    />
  );

  return (
    <div className="space-y-1 px-1 py-0.5">
      {hasExpandableDetails ? (
        <details
          className="group"
          onToggle={(event) => {
            if (event.target === event.currentTarget) setDetailsOpen(event.currentTarget.open);
          }}
        >
          <summary className="list-none [&::-webkit-details-marker]:hidden">{summaryRow}</summary>
          <div className="ml-5 mt-1 space-y-2">
            {hasInput && meta.input ? (
              <ToolInputDetails
                input={meta.input}
                workingDirectory={sessionWorkingDirectory}
                className="rounded border border-border bg-card"
                textClassName="text-foreground"
                visible={detailsOpen}
              />
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
          <div className="space-y-2 border-t border-border p-2 text-xs text-foreground">
            {questionDetailRenderEntries.map(({ key, detail }) => (
              <div key={key} className="space-y-0.5">
                <AgentChatTranscriptProse className="font-medium text-foreground">
                  {detail.prompt}
                </AgentChatTranscriptProse>
                <AgentChatTranscriptProse
                  className={
                    detail.answers.length > 0 ? "text-foreground" : "italic text-muted-foreground"
                  }
                >
                  {detail.answers.length > 0 ? detail.answers.join(", ") : "No answer yet"}
                </AgentChatTranscriptProse>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {meta.toolType === "file_edit" &&
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
