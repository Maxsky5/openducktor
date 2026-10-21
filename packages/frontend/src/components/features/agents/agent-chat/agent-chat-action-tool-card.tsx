import { ChevronDown, ImageIcon, type LucideIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { MediaPreviewDialog, type MediaPreviewItem } from "@/components/ui/media-preview-dialog";
import { cn } from "@/lib/utils";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";
import { getToolDuration } from "./tool-duration";
import { isToolMessageActive, isToolMessageFailure } from "./tool-lifecycle";

/** A detail of an action tool call. A section with no text does not show. */
export type ActionToolSection = { label: string; text: string; tone?: "error" };

/** The screenshots of an action. A card that reads them from the host loads them on request. */
export type ActionToolScreenshots = {
  count: number;
  /** Image sources, such as data URLs, or null until `load` reads them. */
  sources: readonly string[] | null;
  load?: () => void;
  /** Why the screenshots could not load. */
  error?: string | null;
};

type ActionToolCardProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  icon: LucideIcon;
  /** The kind of action, such as `Browser`. */
  label: string;
  title: string;
  screenshots: ActionToolScreenshots;
  sections: readonly ActionToolSection[];
};

/**
 * One tool call that acts on a screen, such as Computer Use or a browser action: a card with the
 * action, its screenshots, and its details.
 */
export const ActionToolCard = ({
  meta,
  messageTimestamp,
  timeLabel,
  icon,
  label,
  title,
  screenshots,
  sections,
}: ActionToolCardProps): ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isFailed = isToolMessageFailure(meta);
  const shownSections = sections.filter((section) => section.text.length > 0);

  const summary = (
    <ActionToolSummary
      meta={meta}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      icon={icon}
      label={label}
      title={title}
      isFailed={isFailed}
      screenshots={screenshots}
      onOpenScreenshots={() => {
        if (screenshots.sources === null) screenshots.load?.();
        setPreviewOpen(true);
      }}
      chevron={shownSections.length > 0 ? (detailsOpen ? "open" : "closed") : "none"}
    />
  );

  return (
    <div
      className={cn(
        "my-2 min-w-0 rounded-lg border px-3 py-2 shadow-sm",
        isFailed ? "border-destructive-border bg-destructive-surface" : "border-border bg-card",
      )}
    >
      {shownSections.length > 0 ? (
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
              {shownSections.map((section) => (
                <ActionToolDetail key={section.label} section={section} />
              ))}
            </div>
          ) : null}
        </details>
      ) : (
        summary
      )}
      <ActionToolScreenshotPreview
        label={label}
        screenshots={screenshots}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
};

/** The row of a card: the action, its Screenshot button, its timing, and the details cue. */
const ActionToolSummary = ({
  meta,
  messageTimestamp,
  timeLabel,
  icon: Icon,
  label,
  title,
  isFailed,
  screenshots,
  onOpenScreenshots,
  chevron,
}: Pick<
  ActionToolCardProps,
  "meta" | "messageTimestamp" | "timeLabel" | "icon" | "label" | "title" | "screenshots"
> & {
  isFailed: boolean;
  onOpenScreenshots: () => void;
  chevron: "none" | "open" | "closed";
}): ReactElement => (
  // The texts share one baseline, so the small label sits on the line of the title.
  <div className="flex min-w-0 items-baseline gap-2">
    <Icon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 self-center",
        isFailed ? "text-destructive-accent" : "text-muted-foreground",
      )}
    />
    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <p
      className={cn(
        "min-w-0 truncate text-sm font-medium",
        isFailed ? "text-destructive-surface-foreground" : "text-foreground",
      )}
    >
      {title}
    </p>
    {screenshots.count > 0 ? (
      <button
        type="button"
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 self-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenScreenshots();
        }}
      >
        <ImageIcon aria-hidden="true" className="size-3" />
        {screenshots.count > 1 ? `Screenshots (${screenshots.count})` : "Screenshot"}
      </button>
    ) : null}
    <ToolMessageTiming
      showSpinner={isToolMessageActive(meta)}
      durationMs={getToolDuration(meta, messageTimestamp)}
      timeLabel={timeLabel}
      className="text-muted-foreground"
    />
    {chevron === "none" ? null : (
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 self-center text-muted-foreground transition-transform motion-reduce:transition-none",
          chevron === "open" && "rotate-180",
        )}
      />
    )}
  </div>
);

/** The load error and the preview dialog of the screenshots of a card. */
const ActionToolScreenshotPreview = ({
  label,
  screenshots,
  open,
  onOpenChange,
}: {
  label: string;
  screenshots: ActionToolScreenshots;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement | null => {
  if (screenshots.error) {
    return (
      <p role="alert" className="mt-1 text-xs text-destructive">
        Screenshot could not be loaded: {screenshots.error}
      </p>
    );
  }
  const media = (screenshots.sources ?? []).map((src, index): MediaPreviewItem => ({
    id: `screenshot-${index + 1}`,
    kind: "image",
    src,
    alt: `${label} screenshot ${index + 1}`,
    unavailableLabel: `Screenshot ${index + 1} is unavailable.`,
  }));
  if (media.length === 0) return null;
  return (
    <MediaPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={media.length > 1 ? `${label} screenshots` : `${label} screenshot`}
      description="Preview of the screenshots from this tool call."
      media={media}
    />
  );
};

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

/** A detail that the user opens, such as a long page snapshot. An error shows at once. */
const ActionToolDetail = ({ section }: { section: ActionToolSection }): ReactElement => {
  const { frameClassName, textClassName } = SECTION_APPEARANCE[section.tone ?? "default"];
  return (
    <details className={cn("rounded border", frameClassName)} open={section.tone === "error"}>
      <summary className={cn("cursor-pointer px-2 py-1 text-xs font-medium", textClassName)}>
        {section.label}
      </summary>
      <pre
        className={cn("overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px]", textClassName)}
      >
        {section.text}
      </pre>
    </details>
  );
};
