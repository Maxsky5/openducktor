import type { WorkflowProblemPath } from "@openducktor/contracts";
import { Plus } from "lucide-react";
import { type ReactElement, type ReactNode, useRef } from "react";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { MoveButtons, RemoveButton } from "../list-row-buttons";
import { moveInList } from "../model/document-edits";
import { fieldPathAttribute, useInspector } from "./inspector-context";
import { useFocusAfterRemove } from "./use-focus-after-remove";
import { useStableKeys } from "./use-stable-keys";
import { FIELD_LABEL_CLASS } from "./field-shell";

type ItemListProps<Item> = {
  /** A title over the items. A list inside a titled group can go without one. */
  label?: string;
  /** A short help line under the label. */
  hint?: string;
  path: WorkflowProblemPath;
  items: readonly Item[];
  onChange: (items: Item[]) => void;
  /** A new valid item. Without it or onAdd, the list offers no Add button. */
  create?: () => Item;
  /** Adds an item that needs a change outside the list, such as a verdict with its transition. */
  onAdd?: () => void;
  renderItem: (item: Item, index: number, update: (item: Item) => void) => ReactNode;
  itemTitle: (item: Item, index: number) => string;
  min?: number;
  addLabel?: string;
  ordered?: boolean;
  /** An item that keeps its place, such as the fallback branch. Others cannot move past it. */
  pinned?: (index: number) => boolean;
  /** A mark before the title, such as a verdict icon. */
  itemLeading?: (item: Item, index: number) => ReactNode;
};

/** A list of nested items, such as outcomes or verdicts, each with its own fields. */
export function ItemList<Item>({
  label,
  hint,
  path,
  items,
  onChange,
  create,
  onAdd,
  renderItem,
  itemTitle,
  min = 0,
  addLabel,
  ordered = false,
  pinned = () => false,
  itemLeading,
}: ItemListProps<Item>): ReactElement {
  const { readOnly } = useInspector();
  const locked = items.length <= min;
  const rows = useStableKeys(items);
  const list = useRef<HTMLElement>(null);
  const { markRemoved } = useFocusAfterRemove(list);
  return (
    <section ref={list} data-field-path={fieldPathAttribute(path)} className="flex flex-col gap-2">
      {label || hint ? (
        <div className="flex flex-col gap-0.5">
          {label ? <h4 className={FIELD_LABEL_CLASS}>{label}</h4> : null}
          {hint ? (
            <p className="text-xs leading-5 text-pretty text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {rows.map(({ item, key }, index) => {
        const title = itemTitle(item, index);
        return (
          <div key={key} className="rounded-lg border border-border/60">
            <div className="flex items-center gap-1.5 py-1.5 pr-1.5 pl-3">
              {itemLeading?.(item, index)}
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={title}>
                {title}
              </span>
              {ordered && !readOnly && !pinned(index) ? (
                <MoveButtons
                  name={title}
                  canMoveUp={index > 0 && !pinned(index - 1)}
                  canMoveDown={index < items.length - 1 && !pinned(index + 1)}
                  onMove={(offset) => onChange(moveInList(items, index, offset))}
                />
              ) : null}
              {readOnly ? null : (
                <RemoveButton
                  name={title}
                  disabled={locked}
                  lockedReason={
                    locked ? "Keep at least one. Delete the element instead." : undefined
                  }
                  onRemove={() => {
                    markRemoved(index);
                    onChange(items.filter((_, other) => other !== index));
                  }}
                />
              )}
            </div>
            <div className="flex flex-col gap-3 px-2.5 pb-2.5">
              {renderItem(item, index, (next) =>
                onChange(items.map((current, other) => (other === index ? next : current))),
              )}
            </div>
          </div>
        );
      })}
      {readOnly || (!create && !onAdd) ? null : (
        <button
          type="button"
          data-add-row=""
          className={LINK_BUTTON_CLASS}
          onClick={() => (onAdd ? onAdd() : create && onChange([...items, create()]))}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {addLabel}
        </button>
      )}
    </section>
  );
}
