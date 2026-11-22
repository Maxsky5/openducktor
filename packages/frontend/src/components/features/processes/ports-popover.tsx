import { ArrowUpRight, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PROCESSES_SURFACE } from "./processes-context";
import { countLabel } from "./processes-labels";

/** One port in the list. A port without a web page has no URL and shows as text. */
export type PortItem = {
  key: string;
  port: number;
  /** The process or the address of the port. */
  detail: string;
  url: string | null;
  title: string;
};

type PortsPopoverProps = {
  items: readonly PortItem[];
  /** The name of the list, such as the task or the command of the ports. */
  listLabel: string;
  disabled?: boolean;
  /** Shows only the number, for a line with little space. */
  compact?: boolean;
  className?: string | undefined;
  onOpenUrl: (url: string) => void;
};

/**
 * Ports as one small button with their count. The button opens a list of the ports, and each web
 * port opens its URL. ArrowUp and ArrowDown move between the ports.
 */
export function PortsPopover({
  items,
  listLabel,
  disabled = false,
  compact = false,
  className,
  onOpenUrl,
}: PortsPopoverProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  if (items.length === 0) return null;
  const count = countLabel(items.length, "port", "ports");
  // Inside the Processes view, the list joins it, so the flyout keeps its focus and its outside
  // clicks.
  const portalContainer = open
    ? (triggerRef.current?.closest<HTMLElement>(PROCESSES_SURFACE) ?? null)
    : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground",
            className,
          )}
          aria-label={`${count} running`}
          title={`${count} running`}
          disabled={disabled}
        >
          <span className="size-1.5 rounded-full bg-status-running" aria-hidden="true" />
          {compact ? items.length : count}
          <ChevronDown className="-ml-0.5 size-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        align="end"
        className="max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto"
        aria-label={listLabel}
      >
        <ul className="flex flex-col" onKeyDown={moveWithArrows}>
          {items.map((item) => (
            <li key={item.key}>
              {item.url ? (
                <PortButton
                  item={item}
                  url={item.url}
                  onOpen={(url) => {
                    setOpen(false);
                    onOpenUrl(url);
                  }}
                />
              ) : (
                <div className="flex items-center gap-2 px-2 py-1.5" title={item.title}>
                  <PortText item={item} muted />
                </div>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PortButton({
  item,
  url,
  onOpen,
}: {
  item: PortItem;
  url: string;
  onOpen: (url: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="group/port flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      title={item.title}
      aria-label={item.title}
      onClick={() => onOpen(url)}
    >
      <PortText item={item} muted={false} />
      <ArrowUpRight
        className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/port:text-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

function PortText({ item, muted }: { item: PortItem; muted: boolean }): ReactElement {
  return (
    <>
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          muted ? "text-muted-foreground" : "text-status-running-foreground",
        )}
      >
        :{item.port}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.detail}</span>
    </>
  );
}

/** ArrowUp and ArrowDown move the focus between the ports that open a URL. */
const moveWithArrows = (event: KeyboardEvent<HTMLUListElement>) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
  const at = buttons.findIndex((button) => button === document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  let next: HTMLButtonElement | undefined;
  // From outside the buttons, ArrowDown goes to the first one and ArrowUp to the last one.
  if (at === -1) next = step === 1 ? buttons[0] : buttons.at(-1);
  else next = buttons.at((at + step) % buttons.length);
  if (!next) return;
  event.preventDefault();
  next.focus();
};
