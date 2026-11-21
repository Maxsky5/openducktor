import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { cn } from "@/lib/utils";
import { IconTile, type KindColor } from "../kind-theme";

type CardHeading = {
  title: string;
  /** One plain line under the title that tells what the card holds or decides. */
  description?: string | undefined;
  Icon?: LucideIcon | undefined;
  color?: KindColor | undefined;
};

function HeadingText({ title, description, Icon, color }: CardHeading): ReactElement {
  return (
    <>
      {Icon ? <IconTile Icon={Icon} color={color ?? "slate"} size="sm" /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold tracking-tight text-foreground">{title}</span>
        {description ? (
          <span className="text-xs leading-5 font-normal text-pretty text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
}

const CARD_CLASS = "shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs";
const HEADER_CLASS = "flex w-full items-start gap-2.5 px-3.5 py-3 text-left";

/**
 * A group of fields of the details panel: a card with an icon, a title, and a short description.
 * A card without a title holds the main fields of the element.
 */
export function PanelCard({
  title,
  description,
  Icon,
  color,
  actions,
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  Icon?: LucideIcon | undefined;
  color?: KindColor | undefined;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className={CARD_CLASS} aria-label={title}>
      {title ? (
        <div className={cn(HEADER_CLASS, children && "border-b border-border/70")}>
          <HeadingText title={title} description={description} Icon={Icon} color={color} />
          {actions}
        </div>
      ) : null}
      {children ? <div className="flex flex-col gap-4 p-3.5">{children}</div> : null}
    </section>
  );
}

/** A card that opens and closes from its header, for the fields that most elements do not need. */
export function CollapsibleCard({
  title,
  description,
  Icon,
  color,
  open,
  onOpenChange,
  marker,
  children,
}: CardHeading & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown before the chevron, such as a count or a problem marker. */
  marker?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const contentId = useId();
  return (
    <section className={CARD_CLASS}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className={cn(
          HEADER_CLASS,
          "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        )}
      >
        <HeadingText title={title} description={description} Icon={Icon} color={color} />
        {marker}
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-90",
          )}
        />
      </button>
      <CssPresenceReveal open={open}>
        <div id={contentId} className="flex flex-col gap-4 border-t border-border/70 p-3.5">
          {children}
        </div>
      </CssPresenceReveal>
    </section>
  );
}
