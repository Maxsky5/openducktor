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

type ActionToolCardProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  icon: LucideIcon;
  /** The kind of action, such as `Browser`. */
  label: string;
  title: string;
  /** Image sources, such as data URLs, that the Screenshot button shows. */
  screenshots: readonly string[];
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
  icon: Icon,
  label,
  title,
  screenshots,
  sections,
}: ActionToolCardProps): ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isFailed = isToolMessageFailure(meta);
  const shownSections = sections.filter((section) => section.text.length > 0);
  const media = screenshots.map((src, index): MediaPreviewItem => ({
    id: `screenshot-${index + 1}`,
    kind: "image",
    src,
    alt: `${label} screenshot ${index + 1}`,
    unavailableLabel: `Screenshot ${index + 1} is unavailable.`,
  }));

  const summary = (
    <div className="flex min-w-0 items-center gap-2">
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
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
      {media.length > 0 ? (
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreviewOpen(true);
          }}
        >
          <ImageIcon aria-hidden="true" className="size-3" />
          {media.length > 1 ? `Screenshots (${media.length})` : "Screenshot"}
        </button>
      ) : null}
      <ToolMessageTiming
        showSpinner={isToolMessageActive(meta)}
        durationMs={getToolDuration(meta, messageTimestamp)}
        timeLabel={timeLabel}
        className="text-muted-foreground"
      />
      {shownSections.length > 0 ? (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            detailsOpen && "rotate-180",
          )}
        />
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
      {media.length > 0 ? (
        <MediaPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={media.length > 1 ? `${label} screenshots` : `${label} screenshot`}
          description="Preview of the screenshots from this tool call."
          media={media}
        />
      ) : null}
    </div>
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
