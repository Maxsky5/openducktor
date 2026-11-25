import type { WorkflowElementKind } from "@openducktor/workflows";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useContext, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import { IconTile } from "../kind-theme";
import { KIND_ICON_CLASSES, KIND_THEME, type KindColor } from "../kind-styles";
import { MoveButtons } from "../list-row-buttons";
import { type OutlineItem, OutlineSearchContext } from "./outline-items";
import { ProblemMarker } from "./problem-marker";

/** The selected or hovered fill of an outline row. */
export const OUTLINE_ROW_CLASS =
  "relative flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-selected-surface aria-[current=true]:font-medium aria-[current=true]:text-foreground";

/**
 * The mark of the selected row of a section: a short bar on the tree line, 10 px to the left of
 * the row, where the 1 px line and the 8 px indent of the list end.
 */
const TREE_MARK_CLASS =
  "before:absolute before:inset-y-1.5 before:-left-[10px] before:w-[3px] before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity aria-[current=true]:before:opacity-100";

function OutlineRow({ item, move }: { item: OutlineItem; move: ReactNode }): ReactElement {
  const { store } = useEditor();
  const selected = useEditorState((state) => state.selection?.key === item.key);
  const problemCount = useEditorView((view) => view.problemsByElement.get(item.key)?.length ?? 0);
  const problemLevel = useEditorView((view) => view.problemLevels.get(item.key) ?? null);
  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        // The full name and its details, since a long row cuts its text.
        title={[item.label, item.title].filter(Boolean).join("\n")}
        className={cn(OUTLINE_ROW_CLASS, TREE_MARK_CLASS)}
        onClick={() => store.getState().select(item.key)}
        // The canvas lights up the element under the pointer.
        onMouseEnter={() => store.getState().hover(item.key)}
        onMouseLeave={() => store.getState().hover(null)}
      >
        {item.leading}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          {item.subtitle ? (
            // Two lines, so a long route keeps its last target.
            <span className="line-clamp-2 text-xs font-normal break-words text-muted-foreground">
              {item.subtitle}
            </span>
          ) : null}
        </span>
        {item.detail ? (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{item.detail}</span>
        ) : null}
        <ProblemMarker level={problemLevel} count={problemCount} />
      </button>
      {move ? (
        // The buttons cover the end of the row, so its text does not move on hover.
        <span className="absolute inset-y-px right-px flex items-center rounded-r-md bg-linear-to-l from-accent from-75% to-transparent pr-1 pl-5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {move}
        </span>
      ) : null}
    </li>
  );
}

const matches = (item: OutlineItem, query: string): boolean => {
  const text = [item.label, item.title, item.searchText].join(" ").toLowerCase();
  return text.includes(query.toLowerCase());
};

/** The tile, title, count, and add command of a section. A click on the title folds it. */
function SectionHeader({
  Icon,
  color,
  title,
  description,
  count,
  open,
  onOpenChange,
  add,
}: {
  Icon: LucideIcon;
  color: KindColor;
  title: string;
  description: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  add: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center gap-1 pr-1">
      {/* A heading holds the disclosure button, so the button can hold no heading. */}
      <h3 className="flex min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onOpenChange(!open)}
              className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IconTile Icon={Icon} color={color} size="sm" />
              <span className="min-w-0 truncate text-[13px] font-semibold">{title}</span>
              {count > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium tabular-nums text-muted-foreground">
                  {count}
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                  !open && "-rotate-90",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="max-w-64">
            {description}
          </TooltipContent>
        </Tooltip>
      </h3>
      {/* A fixed slot, so the chevrons line up with or without an add command. */}
      <span className="flex w-6 shrink-0 justify-center">{add}</span>
    </div>
  );
}

/**
 * A titled list of elements that folds. A click selects an element. An empty section explains
 * what it holds and offers its first element. A search shows only the matching elements.
 */
export function OutlineSection({
  kind,
  title,
  description,
  items,
  add,
  emptyAction,
  reorder,
  count = items.length,
  foldedAtStart = false,
}: {
  /** The kind of the elements, which gives the icon and the colour. */
  kind: WorkflowElementKind;
  title: string;
  /** One plain sentence that tells what the section holds. */
  description: string;
  items: readonly OutlineItem[];
  /** The add command in the header. */
  add?: ReactNode;
  /** The add command of an empty section, such as a link. */
  emptyAction?: ReactNode;
  /** Moves an item by one place. Pinned items have no move buttons, and nothing passes them. */
  reorder?: { move: (index: number, offset: -1 | 1) => void; pinned: (index: number) => boolean };
  /** The count in the header. Zero hides it. */
  count?: number;
  /** The section starts folded even with items, such as one that Workflow settings shows too. */
  foldedAtStart?: boolean;
}): ReactElement | null {
  const readOnly = useEditorState((state) => state.readOnly);
  const query = useContext(OutlineSearchContext).trim();
  // Null follows the items: an empty section folds to its header and its add command, and opens
  // with its first item. A click on the title decides after that.
  const [chosenOpen, setOpen] = useState<boolean | null>(null);
  const open = chosenOpen ?? (items.length > 0 && !foldedAtStart);
  const searching = query.length > 0;
  const shown = searching ? items.filter((item) => matches(item, query)) : items;
  if (searching && shown.length === 0) return null;
  // A search reorders nothing, so the rows keep their move buttons only without one.
  const moveButtons = (item: OutlineItem, index: number): ReactNode => {
    if (!reorder || readOnly || searching || reorder.pinned(index)) return null;
    return (
      <MoveButtons
        name={item.label}
        canMoveUp={index > 0 && !reorder.pinned(index - 1)}
        canMoveDown={index < items.length - 1 && !reorder.pinned(index + 1)}
        onMove={(offset) => reorder.move(index, offset)}
      />
    );
  };
  const expanded = open || searching;
  return (
    <section aria-label={title} className="flex flex-col gap-0.5 py-1.5">
      <SectionHeader
        Icon={KIND_THEME[kind].Icon}
        color={KIND_THEME[kind].color}
        title={title}
        description={description}
        count={searching ? shown.length : count}
        open={expanded}
        onOpenChange={setOpen}
        add={readOnly ? null : add}
      />
      {expanded && items.length === 0 && !readOnly ? (
        <div className="pb-1 pl-10">{emptyAction}</div>
      ) : null}
      {expanded && shown.length > 0 ? (
        <ul className="ml-[18px] flex flex-col gap-px border-l border-border/70 pl-2">
          {shown.map((item, index) => (
            <OutlineRow key={item.key} item={item} move={moveButtons(item, index)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A small round mark before a label, such as the colour of a state. */
export function Dot({ className }: { className: string }): ReactElement {
  return (
    <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
      <span className={cn("size-2 rounded-full", className)} />
    </span>
  );
}

/** A small icon before a label, in the colour of its section, such as the kind of an action. */
export function RowIcon({ Icon, color }: { Icon: LucideIcon; color: KindColor }): ReactElement {
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", KIND_ICON_CLASSES[color])} />;
}
