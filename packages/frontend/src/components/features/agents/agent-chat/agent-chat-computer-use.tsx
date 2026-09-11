import type { AgentToolImage } from "@openducktor/contracts";
import { ChevronDown, ImageIcon, MousePointerClick } from "lucide-react";
import { type ReactElement, useState } from "react";
import { MediaPreviewDialog, type MediaPreviewItem } from "@/components/ui/media-preview-dialog";
import { cn } from "@/lib/utils";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";
import { getToolDuration } from "./tool-duration";
import { hasNonEmptyText, isToolMessageActive, isToolMessageFailure } from "./tool-lifecycle";

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const isFailed = isToolMessageFailure(meta);
  const action = meta.computerUse;
  const code = action?.code ?? "";
  const errorText = hasNonEmptyText(meta.error) ? meta.error : "";
  const outputText = hasNonEmptyText(meta.output) ? meta.output : "";
  const hasDetails = code.length > 0 || errorText.length > 0 || outputText.length > 0;
  const previewMedia = buildComputerUsePreviewMedia(action?.images ?? []);

  const summary = (
    <ComputerUseSummary
      actionTitle={action?.action ?? DEFAULT_ACTION_TITLE}
      isFailed={isFailed}
      isActive={isToolMessageActive(meta)}
      durationMs={getToolDuration(meta, messageTimestamp)}
      timeLabel={timeLabel}
      screenshotCount={previewMedia.length}
      showDetailsCue={hasDetails}
      detailsOpen={detailsOpen}
      onOpenScreenshotPreview={() => setPreviewOpen(true)}
    />
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
            <ComputerUseDetails code={code} errorText={errorText} outputText={outputText} />
          ) : null}
        </details>
      ) : (
        summary
      )}
      {previewMedia.length > 0 ? (
        <MediaPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={previewMedia.length > 1 ? "Computer Use screenshots" : "Computer Use screenshot"}
          description="Preview of the screenshots from this computer use call."
          media={previewMedia}
        />
      ) : null}
    </div>
  );
};

const DEFAULT_ACTION_TITLE = "Computer action";

type ComputerUseSummaryProps = {
  actionTitle: string;
  isFailed: boolean;
  isActive: boolean;
  durationMs: number | null;
  timeLabel: string;
  screenshotCount: number;
  showDetailsCue: boolean;
  detailsOpen: boolean;
  onOpenScreenshotPreview: () => void;
};

const ComputerUseSummary = ({
  actionTitle,
  isFailed,
  isActive,
  durationMs,
  timeLabel,
  screenshotCount,
  showDetailsCue,
  detailsOpen,
  onOpenScreenshotPreview,
}: ComputerUseSummaryProps): ReactElement => (
  <div className="min-w-0">
    <div className="flex min-w-0 items-center gap-2">
      <MousePointerClick
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
      {screenshotCount > 0 ? (
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenScreenshotPreview();
          }}
        >
          <ImageIcon aria-hidden="true" className="size-3" />
          {screenshotCount > 1 ? `Screenshots (${screenshotCount})` : "Screenshot"}
        </button>
      ) : null}
      <ToolMessageTiming
        showSpinner={isActive}
        durationMs={durationMs}
        timeLabel={timeLabel}
        className="text-muted-foreground"
      />
      {showDetailsCue ? (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            detailsOpen && "rotate-180",
          )}
        />
      ) : null}
    </div>
  </div>
);

const ComputerUseDetails = ({
  code,
  errorText,
  outputText,
}: {
  code: string;
  errorText: string;
  outputText: string;
}): ReactElement => (
  <div className="mt-2 space-y-2">
    {code.length > 0 ? <ComputerUseSection label="JavaScript">{code}</ComputerUseSection> : null}
    {errorText.length > 0 ? (
      <ComputerUseSection label="Error" tone="error">
        {errorText}
      </ComputerUseSection>
    ) : null}
    {outputText.length > 0 ? (
      <ComputerUseSection label="Output">{outputText}</ComputerUseSection>
    ) : null}
  </div>
);

const buildComputerUsePreviewMedia = (images: AgentToolImage[]): MediaPreviewItem[] =>
  images.map((image, index) => ({
    kind: "image",
    src: `data:${image.mimeType};base64,${image.dataBase64}`,
    alt: `Computer Use screenshot ${index + 1}`,
    unavailableLabel: `Screenshot ${index + 1} is unavailable.`,
  }));

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
