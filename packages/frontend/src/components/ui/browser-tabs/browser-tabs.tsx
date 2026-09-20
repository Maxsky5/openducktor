import { DndContext, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  horizontalTabDropAnimation,
  horizontalTabSortTransition,
  type HorizontalTabDropPosition,
  useHorizontalSortableTabs,
} from "@/components/ui/use-horizontal-sortable-tabs";
import { cn } from "@/lib/utils";
import { browserTabLabelClassName, browserTabShellClassName } from "./browser-tab-styles";
import { useBrowserTabsSelection } from "./browser-tabs-root";

export type BrowserTabItem = {
  value: string;
  content: ReactNode;
  action?: ReactNode;
  triggerProps?: Omit<
    ComponentProps<typeof TabsTrigger>,
    "value" | "children" | "onMouseDown" | "onMouseUp"
  >;
  attributes?: { [key: `data-${string}`]: string };
};

function BrowserTabTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsTrigger>): ReactElement {
  return (
    <TabsTrigger
      className={cn(
        browserTabLabelClassName,
        "data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

type SortableBrowserTabProps = {
  item: BrowserTabItem;
  selected: boolean;
  shouldSuppressSelection: (value: string) => boolean;
  onSelect: (value: string) => void;
};

function SortableBrowserTab({
  item,
  selected,
  shouldSuppressSelection,
  onSelect,
}: SortableBrowserTabProps): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.value,
    transition: horizontalTabSortTransition,
  });
  return (
    <div
      {...item.attributes}
      ref={setNodeRef}
      data-slot="browser-tab"
      data-active={selected ? "true" : "false"}
      data-dragging={isDragging ? "true" : "false"}
      className={cn(browserTabShellClassName(selected), "touch-none", isDragging && "opacity-0")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
    >
      <BrowserTabTrigger
        {...item.triggerProps}
        value={item.value}
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          if (shouldSuppressSelection(item.value)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelect(item.value);
        }}
      >
        {item.content}
      </BrowserTabTrigger>
      {item.action ? (
        <span
          className="inline-flex shrink-0"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {item.action}
        </span>
      ) : null}
    </div>
  );
}

type BrowserTabDragPreviewProps = {
  item: BrowserTabItem;
  selectedValue: string;
};

function BrowserTabDragPreview({ item, selectedValue }: BrowserTabDragPreviewProps): ReactElement {
  return (
    <div aria-hidden="true" inert>
      <Tabs value={selectedValue}>
        <TabsList className="h-auto rounded-none bg-transparent p-0">
          <div className={cn(browserTabShellClassName(item.value === selectedValue), "touch-none")}>
            <BrowserTabTrigger
              value={item.value}
              title={item.triggerProps?.title}
              className={item.triggerProps?.className}
            >
              {item.content}
            </BrowserTabTrigger>
            {item.action ? <span className="inline-flex shrink-0">{item.action}</span> : null}
          </div>
        </TabsList>
      </Tabs>
    </div>
  );
}

type BrowserTabsProps = {
  items: BrowserTabItem[];
  onReorder: (draggedId: string, targetId: string, position: HorizontalTabDropPosition) => void;
} & Omit<ComponentProps<typeof TabsList>, "children" | "onSelect">;

/** Reorderable browser-style tabs. Render within BrowserTabsRoot. */
export function BrowserTabs({
  items,
  onReorder,
  className,
  ...listProps
}: BrowserTabsProps): ReactElement {
  const { value: selectedValue, onValueChange } = useBrowserTabsSelection();
  const itemIds = items.map((item) => item.value);
  const drag = useHorizontalSortableTabs({ itemIds, onReorder });
  const preview = items.find((item) => item.value === drag.activeId);
  return (
    <DndContext
      sensors={drag.sensors}
      collisionDetection={drag.collisionDetection}
      measuring={drag.measuring}
      modifiers={drag.modifiers}
      onDragStart={drag.handleDragStart}
      onDragEnd={drag.handleDragEnd}
      onDragCancel={drag.handleDragCancel}
    >
      <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
        <TabsList
          {...listProps}
          className={cn(
            "h-auto min-h-8 w-max justify-start gap-1 rounded-none bg-transparent p-0",
            className,
          )}
        >
          {items.map((item) => (
            <SortableBrowserTab
              key={item.value}
              item={item}
              selected={item.value === selectedValue}
              shouldSuppressSelection={drag.shouldSuppressSelection}
              onSelect={onValueChange}
            />
          ))}
        </TabsList>
      </SortableContext>
      <DragOverlay dropAnimation={horizontalTabDropAnimation} zIndex={40}>
        {preview ? <BrowserTabDragPreview item={preview} selectedValue={selectedValue} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
