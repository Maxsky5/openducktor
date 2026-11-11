import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  formatToolInput,
  readToolDetailAvailability,
  readToolDetailsError,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import { getToolDuration } from "@openducktor/frontend-core/sessions/messages/tool-duration";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import { TriangleAlert } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode, useMemo } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { AgentToolResultContentView } from "./agent-tool-result-content";
import { TOOL_STATUS, ToolStatusIcon } from "./agent-chat-tool-status";

export type ToolDetailsTiming = { messageTimestamp: string; timeLabel: string };

/**
 * The call that the details show: the icon of its kind, its name, its status and run facts, and
 * the reason that the agent gave for it. Details that are not a panel tab also get a close control.
 */
export const DetailsHeading = ({
  icon,
  title,
  titleClassName,
  meta,
  messageTimestamp,
  timeLabel,
  exitCode = null,
  description = null,
  closeAction,
}: {
  icon: ReactNode;
  title: string;
  titleClassName?: string;
  meta: ToolMeta;
  exitCode?: number | null;
  description?: string | null;
  closeAction?: ReactNode;
} & ToolDetailsTiming): ReactElement => (
  <header className="shrink-0 space-y-2.5">
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={cn("truncate text-[13px] leading-5 font-semibold", titleClassName)}>
          {title}
        </h2>
        <DetailsStatusLine
          meta={meta}
          messageTimestamp={messageTimestamp}
          timeLabel={timeLabel}
          exitCode={exitCode}
        />
      </div>
      {closeAction ? <div className="-mt-0.5 -mr-1.5 shrink-0">{closeAction}</div> : null}
    </div>
    {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
  </header>
);

/**
 * The status of a call and its run facts, such as `Failed · exit 2 · 1.2s · 09:28:50 PM`. Each
 * fact shows only when the runtime gave it.
 */
export const DetailsStatusLine = ({
  meta,
  messageTimestamp,
  timeLabel,
  exitCode = null,
}: {
  meta: ToolMeta;
  exitCode?: number | null;
} & ToolDetailsTiming): ReactElement => {
  const phase = getToolLifecyclePhase(meta);
  const durationMs = getToolDuration(meta, messageTimestamp);
  const failedExit = exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null;
  const facts = [
    failedExit,
    durationMs === null ? null : formatAgentDuration(durationMs),
    timeLabel || null,
  ].filter((fact) => fact !== null);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-medium",
          TOOL_STATUS[phase].textClassName,
        )}
      >
        <ToolStatusIcon phase={phase} decorative />
        {TOOL_STATUS[phase].label}
      </span>
      {facts.map((fact) => (
        <Fragment key={fact}>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span
            className={cn(
              "tabular-nums",
              fact === failedExit ? "font-mono text-destructive-muted" : "text-muted-foreground",
            )}
          >
            {fact}
          </span>
        </Fragment>
      ))}
    </p>
  );
};

/** The input, output, and error of a tool call that is not a shell command. */
export const ToolCallDetails = ({
  meta,
  title,
  icon,
  note = null,
  workingDirectory,
  closeAction,
  messageTimestamp,
  timeLabel,
}: {
  meta: ToolMeta;
  /** The name of the tool, as the transcript shows it. */
  title: string;
  /** The icon of the tool, as the transcript shows it. */
  icon: ReactNode;
  /** The Markdown note of a workflow event, which shows before its input. */
  note?: string | null;
  workingDirectory: string | null;
  /** The close control of details that are not a panel tab. */
  closeAction?: ReactNode;
} & ToolDetailsTiming): ReactElement => {
  const { hasInput, hasOutput } = readToolDetailAvailability(meta);
  const input = useMemo(
    () => (meta.input && hasInput ? formatToolInput(meta.input, workingDirectory) : ""),
    [meta.input, hasInput, workingDirectory],
  );
  const error = readToolDetailsError(meta);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-5">
        <DetailsHeading
          icon={icon}
          title={title}
          meta={meta}
          messageTimestamp={messageTimestamp}
          timeLabel={timeLabel}
          closeAction={closeAction}
        />
        {error ? <DetailsError error={error} /> : null}
        {note ? (
          <section aria-label="Note" className="flex flex-col gap-1.5">
            <div className="flex h-7 items-center">
              <h4 className="text-xs font-medium">Note</h4>
            </div>
            <AgentChatMarkdownRenderer markdown={note} variant="compact" />
          </section>
        ) : null}
        {input ? (
          <DetailsBlock label="Input" copyText={input} kind="input">
            <pre className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{input}</pre>
          </DetailsBlock>
        ) : null}
        {hasOutput ? (
          <DetailsBlock
            label="Output"
            copyText={meta.resultContent ? "" : (meta.output ?? "")}
            kind="output"
          >
            <AgentToolResultContentView content={meta.resultContent} output={meta.output} />
          </DetailsBlock>
        ) : null}
        {input || hasOutput || error || note ? null : (
          <p className="text-xs leading-5 text-muted-foreground">
            The tool call has no input or output.
          </p>
        )}
      </div>
    </div>
  );
};

/** The error of a failed call, which the reader can copy. */
export const DetailsError = ({ error }: { error: string }): ReactElement => (
  <section
    aria-label="Error"
    className="flex gap-2.5 rounded-lg border border-destructive-border bg-destructive-surface py-2.5 pr-1.5 pl-3 text-destructive-surface-foreground"
  >
    <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
    <pre className="m-0 min-w-0 flex-1 font-mono text-[11.5px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {formatRawJsonLikeText(error)}
    </pre>
    <DetailsCopyButton text={error} what="error" className="-my-1" />
  </section>
);

/**
 * The input or the output of a call, under its label. The input shows in a filled block and the
 * output in an outlined block, as in the details of a shell command.
 */
const DetailsBlock = ({
  label,
  copyText,
  kind,
  children,
}: {
  label: string;
  copyText: string;
  kind: "input" | "output";
  children: ReactNode;
}): ReactElement => (
  <section aria-label={label} className="flex flex-col gap-1.5">
    <div className="flex h-7 items-center justify-between gap-2">
      <h4 className="text-xs font-medium">{label}</h4>
      {copyText ? (
        <DetailsCopyButton text={copyText} what={label.toLowerCase()} className="-mr-1.5" />
      ) : null}
    </div>
    <div
      className={cn(
        "max-h-[60vh] min-w-0 overflow-auto rounded-lg px-3 py-2.5 font-mono text-[12px] leading-5 text-foreground",
        kind === "input" ? "bg-muted" : "border border-border",
      )}
    >
      {children}
    </div>
  </section>
);

export const DetailsCopyButton = ({
  text,
  what,
  className,
}: {
  text: string;
  what: string;
  className?: string;
}): ReactElement => {
  const { copied, copyToClipboard } = useCopyToClipboard({ successMessage: `Copied the ${what}` });
  return (
    <CopyIconButton
      copied={copied}
      ariaLabel={`Copy ${what}`}
      tooltipLabel={copied ? "Copied" : `Copy ${what}`}
      onClick={() => void copyToClipboard(text)}
      className={cn("size-7 shrink-0 border-transparent bg-transparent shadow-none", className)}
    />
  );
};
