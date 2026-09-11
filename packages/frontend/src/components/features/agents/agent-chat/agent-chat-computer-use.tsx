import type { AgentToolImage } from "@openducktor/contracts";
import { ChevronDown, LoaderCircle, Monitor } from "lucide-react";
import { type ReactElement, useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { formatAgentDuration } from "./format-agent-duration";
import { getToolDuration } from "./tool-duration";
import { hasNonEmptyText, isToolMessageFailure } from "./tool-lifecycle";

type ComputerUseToolMessageProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
};

export const ComputerUseToolMessage = ({
  meta,
  messageTimestamp,
  timeLabel,
}: ComputerUseToolMessageProps): ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isFailed = isToolMessageFailure(meta);
  const action = meta.computerUse;
  const actionTitle = action?.action ?? DEFAULT_ACTION_TITLE;
  const failureSummary = isFailed ? (action?.failureSummary ?? FAILED_SUMMARY) : "";
  const durationMs = getToolDuration(meta, messageTimestamp);
  const code = action?.code ?? "";
  const images = action?.images ?? [];
  const errorText = hasNonEmptyText(meta.error) ? meta.error : "";
  const outputText = hasNonEmptyText(meta.output) ? meta.output : "";
  const hasDetails =
    code.length > 0 || errorText.length > 0 || outputText.length > 0 || images.length > 0;

  const summary = (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <Monitor
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            isFailed ? "text-destructive-accent" : "text-muted-foreground",
          )}
        />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Computer Use
        </span>
        <p
          className={cn(
            "min-w-0 truncate text-sm font-medium",
            isFailed ? "text-destructive-surface-foreground" : "text-foreground",
          )}
        >
          {actionTitle}
        </p>
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {isActiveComputerUse(meta) ? <LoaderCircle className="size-3 animate-spin" /> : null}
          {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
          {timeLabel ? <span>{timeLabel}</span> : null}
        </span>
        {hasDetails ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              detailsOpen && "rotate-180",
            )}
          />
        ) : null}
      </div>
      {failureSummary.length > 0 ? (
        <p className="mt-1 line-clamp-2 pl-6 text-xs text-destructive-surface-foreground">
          {failureSummary}
        </p>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "my-2 min-w-0 rounded-lg border px-3 py-2 shadow-sm",
        isFailed ? "border-destructive-border bg-destructive-surface" : "border-border bg-card",
      )}
    >
      {hasDetails ? (
        <details
          className="group"
          onToggle={(event) => {
            if (event.target === event.currentTarget) setDetailsOpen(event.currentTarget.open);
          }}
        >
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            {summary}
          </summary>
          {detailsOpen ? (
            <div className="mt-2 space-y-2">
              {code.length > 0 ? (
                <ComputerUseSection label="JavaScript">{code}</ComputerUseSection>
              ) : null}
              {errorText.length > 0 ? (
                <ComputerUseSection label="Error" tone="error">
                  {errorText}
                </ComputerUseSection>
              ) : null}
              {outputText.length > 0 ? (
                <ComputerUseSection label="Output">{outputText}</ComputerUseSection>
              ) : null}
              {images.length > 0 ? (
                <div className="space-y-2">
                  {images.map((image, index) => (
                    <ComputerUseScreenshot
                      key={`${index}:${image.mimeType}`}
                      image={image}
                      index={index}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : (
        summary
      )}
    </div>
  );
};

const DEFAULT_ACTION_TITLE = "Computer action";

const FAILED_SUMMARY = "Computer action failed.";

const isActiveComputerUse = (meta: ToolMeta): boolean =>
  meta.status === "pending" || meta.status === "running";

const SECTION_APPEARANCE = {
  default: {
    frameClassName: "border-border bg-muted/50",
    textClassName: "text-foreground",
  },
  error: {
    frameClassName: "border-destructive-border bg-destructive-surface",
    textClassName: "text-destructive-surface-foreground",
  },
} as const;

const ComputerUseSection = ({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: string;
  tone?: "default" | "error";
}): ReactElement => {
  const { frameClassName, textClassName } = SECTION_APPEARANCE[tone];
  return (
    <div className={cn("rounded border", frameClassName)}>
      <p className={cn("px-2 py-1 text-xs font-medium", textClassName)}>{label}</p>
      <pre
        className={cn("overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]", textClassName)}
      >
        {children}
      </pre>
    </div>
  );
};

const ComputerUseScreenshot = ({
  image,
  index,
}: {
  image: AgentToolImage;
  index: number;
}): ReactElement => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p role="alert" className="rounded border border-border bg-muted/50 px-2 py-2 text-[11px]">
        Screenshot {index + 1} is unavailable.
      </p>
    );
  }
  return (
    <img
      src={`data:${image.mimeType};base64,${image.dataBase64}`}
      alt={`Computer Use screenshot ${index + 1}`}
      className="max-h-80 w-full rounded border border-border bg-muted/40 object-contain"
      onError={() => setFailed(true)}
    />
  );
};
