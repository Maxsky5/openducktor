import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  PANEL_TAB_BADGE_LABELS,
  type PanelTabBadge,
  type PanelTabPresentation,
} from "./session-panel-tab-presentation";

/** The favicon or the icon of a panel tab, with the marks over it. */
export function PanelTabIcon({
  presentation,
  showsPromptMark,
  children,
}: {
  presentation: PanelTabPresentation;
  /** Shows that the page waits for an answer. A selected tab shows the prompt itself. */
  showsPromptMark: boolean;
  /** Other marks over the icon, such as a status that the page gives. */
  children?: ReactNode;
}): ReactElement {
  const Icon = presentation.icon;
  return (
    <span className="relative inline-flex shrink-0">
      {presentation.iconUrl ? (
        <img
          src={presentation.iconUrl}
          alt=""
          draggable={false}
          className="size-3.5 rounded-[2px] object-contain"
        />
      ) : (
        <Icon className="size-3.5" aria-hidden="true" />
      )}
      {presentation.isAgentActive ? (
        <span
          aria-hidden="true"
          data-panel-tab-mark="agent-active"
          className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info-accent ring-1 ring-card motion-safe:animate-pulse"
        />
      ) : null}
      {showsPromptMark ? (
        <span
          aria-hidden="true"
          data-panel-tab-mark="prompts"
          className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-warning-accent ring-1 ring-card"
        />
      ) : null}
      {children}
    </span>
  );
}

const BADGE_CLASS_NAMES = {
  shared: "bg-muted text-muted-foreground ring-1 ring-border ring-inset",
  agent: "bg-info-surface text-info-surface-foreground ring-1 ring-info-border/40 ring-inset",
} satisfies Record<PanelTabBadge, string>;

/** A small badge that tells who can use a browser tab. */
export function PanelTabBadgeView({ badge }: { badge: PanelTabBadge }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-sm px-1 text-[10px] leading-4 font-medium",
        BADGE_CLASS_NAMES[badge],
      )}
    >
      {PANEL_TAB_BADGE_LABELS[badge]}
    </span>
  );
}
