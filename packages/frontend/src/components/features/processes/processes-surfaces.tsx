import { Cpu, PictureInPicture, PictureInPicture2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { FloatingWindow, type FloatingWindowRect } from "@/components/ui/floating-window";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ShortcutButton } from "@/features/shortcuts/shortcut-controls";
import {
  PROCESSES_SURFACE,
  useFloatingPlacement,
  useProcessList,
  useProcessesActions,
  useProcessesViewState,
} from "./processes-context";
import { ProcessesPanel } from "./processes-panel";
import { countLabel } from "./processes-labels";
import { runningCommandCount } from "./processes-view";

/**
 * The Processes button of the rail. Its badge counts the running commands of all open
 * workspaces. It opens the list as a flyout beside the rail, which leaves the app usable: a
 * click elsewhere or Escape closes it, and the pin keeps it as a panel.
 */
export function ProcessesRailButton(): ReactElement | null {
  const actions = useProcessesActions();
  const { view } = useProcessesViewState();
  const { data: running = 0 } = useProcessList(runningCommandCount);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState("");
  if (!actions) return null;
  const open = view === "flyout";
  const label =
    running > 0 ? `Processes, ${countLabel(running, "command", "commands")} running` : "Processes";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setFilter("");
        actions.closeProcesses();
      }}
    >
      <PopoverAnchor asChild>
        <ShortcutButton
          ref={buttonRef}
          shortcutId="processes"
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-9 text-sidebar-muted-foreground hover:text-sidebar-foreground data-[open=true]:bg-sidebar-accent data-[open=true]:text-sidebar-accent-foreground"
          aria-label={label}
          aria-expanded={view !== "closed"}
          data-open={view !== "closed"}
          title={
            running > 0 ? `${label} · Running processes and ports` : "Running processes and ports"
          }
          onClick={actions.toggleProcesses}
        >
          <Cpu aria-hidden="true" />
          {/* The open view shows the count in its toolbar, so the badge waits until it closes. */}
          {running > 0 && view === "closed" ? (
            <span
              // A soft tint, so the count tells without pulling the eye from the work.
              className="process-badge-enter pointer-events-none absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-running/15 px-1 text-[9px] leading-none font-semibold text-status-running-foreground tabular-nums"
              aria-hidden="true"
            >
              {running}
            </span>
          ) : null}
        </ShortcutButton>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={18}
        className="w-[36rem] max-w-[calc(100vw-6rem)] overflow-hidden p-0 shadow-2xl"
        data-processes-surface=""
        aria-label="Processes"
        // Typing filters at once, so the filter takes the focus first.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          filterRef.current?.focus();
        }}
        // Focus can leave, as when a dialog that opened the flyout closes. Only a click closes it.
        onFocusOutside={(event) => event.preventDefault()}
        // The rail button toggles the flyout itself.
        onPointerDownOutside={(event) => {
          if (event.target instanceof Node && buttonRef.current?.contains(event.target))
            event.preventDefault();
        }}
        // The first Escape clears the filter. The next one closes the flyout.
        onEscapeKeyDown={(event) => {
          if (filter === "") return;
          event.preventDefault();
          setFilter("");
        }}
      >
        <ProcessesPanel
          filterRef={filterRef}
          filter={filter}
          onFilterChange={setFilter}
          toolbarActions={
            <FlyoutActions onDetach={actions.detach} onClose={actions.closeProcesses} />
          }
          listClassName="[&>[data-slot=scroll-area-viewport]]:max-h-[min(32rem,65dvh)] [&>[data-slot=scroll-area-viewport]]:min-h-60"
        />
      </PopoverContent>
    </Popover>
  );
}

/** The list detached from the rail. It floats over the app and stays across navigation. */
export function ProcessesFloatingWindow(): ReactElement | null {
  const actions = useProcessesActions();
  const placement = useFloatingPlacement();
  const floating = useProcessesViewState().view === "floating";
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState("");
  // The filter takes the focus when the window opens, as it does in the flyout.
  useEffect(() => {
    if (floating) filterRef.current?.focus();
  }, [floating]);
  if (!actions || !placement || !floating) return null;
  // Escape clears the filter. The window stays until the user closes or attaches it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || filter === "") return;
    event.preventDefault();
    setFilter("");
  };
  return (
    <FloatingWindow
      id="processes"
      title="Processes"
      icon={<Cpu />}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Attach to the rail"
          title="Attach to the rail"
          onClick={actions.attach}
        >
          <PictureInPicture className="size-3.5" aria-hidden="true" />
        </Button>
      }
      onClose={actions.closeProcesses}
      rect={placement.rect}
      onRectChange={placement.setRect}
      minSize={FLOATING_MIN_SIZE}
    >
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
        <ProcessesPanel
          filterRef={filterRef}
          filter={filter}
          onFilterChange={setFilter}
          className="h-full"
          listClassName="flex-1"
        />
      </div>
    </FloatingWindow>
  );
}

const FLOATING_MIN_SIZE = { width: 400, height: 280 };

/**
 * Detach and Close at the end of the flyout toolbar. The window opens where the flyout was, so
 * the list seems to come loose from the rail.
 */
function FlyoutActions({
  onDetach,
  onClose,
}: {
  onDetach: (rect: FloatingWindowRect) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label="Detach into a floating window"
        title="Detach into a floating window. It stays open over the app until you close it."
        onClick={(event) => {
          const bounds = event.currentTarget.closest(PROCESSES_SURFACE)?.getBoundingClientRect();
          if (bounds)
            onDetach({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        }}
      >
        <PictureInPicture2 className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-ml-1 size-7 shrink-0 text-muted-foreground"
        aria-label="Close processes"
        title="Close"
        onClick={onClose}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}
