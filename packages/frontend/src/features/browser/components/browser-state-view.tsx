import type { LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export type BrowserStateTone = "neutral" | "info" | "warning" | "danger";

const TONE_CLASS_NAMES = {
  neutral: "bg-muted text-muted-foreground ring-border",
  info: "bg-info-surface text-info-muted ring-info-border/50",
  warning: "bg-warning-surface text-warning-muted ring-warning-border/60",
  danger: "bg-destructive-surface text-destructive-muted ring-destructive-border/60",
} satisfies Record<BrowserStateTone, string>;

export type BrowserStateViewProps = {
  icon: LucideIcon;
  tone: BrowserStateTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
};

/** A message that fills the page area of a browser tab in place of the page. */
export function BrowserStateView({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: BrowserStateViewProps): ReactElement {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex h-full w-full overflow-y-auto bg-card p-6">
      {/* Auto margins center the message, and a message taller than the page area scrolls. */}
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-3 text-center">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            TONE_CLASS_NAMES[tone],
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {children ? (
          <div className="flex w-full flex-col items-center gap-2 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
            {children}
          </div>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
