import { ChevronRight } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { cn } from "@/lib/utils";

/** A titled group of fields that opens and closes, such as "More rules" or "Advanced". */
export function Disclosure({
  title,
  open,
  onOpenChange,
  marker,
  description,
  className,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown after the title, such as a problem marker. */
  marker?: ReactNode;
  /** One muted line under the title that tells what the group holds. */
  description?: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const contentId = useId();
  return (
    <section className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-start gap-1.5 rounded-md py-1 text-left text-sm font-semibold text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-90",
          )}
        />
        <span className="flex flex-1 flex-col">
          <span>{title}</span>
          {description ? (
            <span className="text-xs font-normal text-muted-foreground">{description}</span>
          ) : null}
        </span>
        {marker}
      </button>
      <CssPresenceReveal open={open}>
        <div id={contentId} className="pt-3">
          {children}
        </div>
      </CssPresenceReveal>
    </section>
  );
}
