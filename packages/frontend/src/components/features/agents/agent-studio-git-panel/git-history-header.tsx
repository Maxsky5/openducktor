import { Columns3 } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useRef,
  useState,
} from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import {
  HISTORY_COLUMNS,
  type HistoryColumnId,
  historyColumnWidth,
  LOCKED_HISTORY_COLUMN,
  useHistoryColumnsStore,
} from "./git-history-columns";

type DropPlace = { id: HistoryColumnId; side: "before" | "after" };

/** The place in the full column order, hidden columns included, where a moved column lands. */
const dropIndex = (
  order: readonly HistoryColumnId[],
  moved: HistoryColumnId,
  place: DropPlace,
): number => {
  const others = order.filter((id) => id !== moved);
  return others.indexOf(place.id) + (place.side === "after" ? 1 : 0);
};

/**
 * The column titles above the commits. A title drags to a new place, and Alt with an arrow key
 * moves the focused column. A right-click or the columns button opens the column choices.
 */
export function HistoryColumnsHeader({
  columns,
  graphWidth,
}: {
  /** The shown columns in their order. */
  columns: HistoryColumnId[];
  graphWidth: number;
}): ReactElement {
  const order = useHistoryColumnsStore((state) => state.order);
  const hidden = useHistoryColumnsStore((state) => state.hidden);
  const toggle = useHistoryColumnsStore((state) => state.toggle);
  const move = useHistoryColumnsStore((state) => state.move);
  const reset = useHistoryColumnsStore((state) => state.reset);
  const hiddenColumns = new Set(hidden);
  const trigger = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<HistoryColumnId | null>(null);
  const [dropPlace, setDropPlace] = useState<DropPlace | null>(null);

  const moveTo = (id: HistoryColumnId, place: DropPlace): void => {
    if (place.id !== id) move(id, dropIndex(order, id, place));
  };
  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    trigger.current?.dispatchEvent(
      new globalThis.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left,
        clientY: bounds.bottom,
      }),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: HistoryColumnId): void => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const index = columns.indexOf(id);
    const left = event.key === "ArrowLeft";
    const neighbor = columns[left ? index - 1 : index + 1];
    if (neighbor) moveTo(id, { id: neighbor, side: left ? "before" : "after" });
  };
  const onDragOver = (event: DragEvent<HTMLButtonElement>, id: HistoryColumnId): void => {
    if (!dragged) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    if (dropPlace?.id !== id || dropPlace.side !== side) setDropPlace({ id, side });
  };
  const endDrag = (): void => {
    setDragged(null);
    setDropPlace(null);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={trigger}
          className="relative flex h-6 shrink-0 items-stretch border-b border-border bg-muted/40 text-[10.5px] font-medium text-muted-foreground"
          data-testid="agent-studio-git-history-header"
        >
          {columns.map((id, index) => {
            const width = historyColumnWidth(id, graphWidth);
            const place = dropPlace?.id === id && dragged !== id ? dropPlace.side : null;
            return (
              <button
                key={id}
                type="button"
                draggable
                className={cn(
                  "relative flex min-w-0 cursor-grab items-center px-2 outline-none select-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing",
                  width === null ? "flex-1" : "shrink-0",
                  id === "date" && "justify-end",
                  // The columns button covers the end of the last title, so its title moves left.
                  index === columns.length - 1 && "pr-7",
                  dragged === id && "opacity-50",
                )}
                style={width === null ? undefined : { width }}
                aria-label={`${HISTORY_COLUMNS[id].label} column. Drag it, or press Alt and an arrow key, to move it.`}
                data-testid={`agent-studio-git-history-column-${id}`}
                onKeyDown={(event) => onKeyDown(event, id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", id);
                  setDragged(id);
                }}
                onDragOver={(event) => onDragOver(event, id)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged && dropPlace) moveTo(dragged, dropPlace);
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <span className="truncate">{HISTORY_COLUMNS[id].label}</span>
                {place ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1 w-0.5 rounded-full bg-primary",
                      place === "before" ? "left-0" : "right-0",
                    )}
                  />
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="absolute top-1/2 right-0.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Choose the History columns"
            title="Choose the History columns"
            onClick={openMenu}
            data-testid="agent-studio-git-history-columns-button"
          >
            <Columns3 className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" data-testid="agent-studio-git-history-columns-menu">
        <ContextMenuLabel>Columns</ContextMenuLabel>
        {order.map((id) => (
          <ContextMenuCheckboxItem
            key={id}
            className="cursor-pointer"
            checked={!hiddenColumns.has(id)}
            disabled={id === LOCKED_HISTORY_COLUMN}
            // The menu stays open, so several columns can change in one visit.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(id)}
          >
            {HISTORY_COLUMNS[id].label}
          </ContextMenuCheckboxItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem className="cursor-pointer" onSelect={reset}>
          Reset columns
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
