import { DndContext, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, X } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  horizontalTabDropAnimation,
  horizontalTabSortTransition,
} from "@/components/ui/use-horizontal-sortable-tabs";
import { cn } from "@/lib/utils";
import {
  type TerminalTab,
  terminalTabLabel,
  terminalTabLifecycle,
} from "./terminal-presentation-state";
import { terminalTabsListClassName, terminalTabTriggerClassName } from "./terminal-tab-styles";
import { useTerminalTabReorderDrag } from "./use-terminal-tab-reorder-drag";

const lifecycleText = (tab: TerminalTab): string => {
  if (tab.requestState === "creating") return "Creating";
  if (tab.requestState === "unsupported_runtime") return "Unsupported runtime";
  if (tab.requestState === "creation_failed") return "Creation failed";
  if (tab.requestState === "lost") return "Lost after host restart";
  const lifecycle = terminalTabLifecycle(tab);
  if (lifecycle === "starting") return "Starting";
  if (lifecycle === "closing") return "Closing";
  if (lifecycle === "close_failed") return "Close failed";
  if (lifecycle === "exited") return "Exited";
  return "Running";
};

const detailText = (tab: TerminalTab): string =>
  tab.summary
    ? `${lifecycleText(tab)}. Started in ${tab.summary.initialWorkingDir}`
    : lifecycleText(tab);

const terminalTabShellClassName =
  "group relative inline-flex h-8 min-w-52 max-w-80 shrink-0 cursor-pointer touch-none select-none items-center font-mono text-[11px]";

function TerminalTabLabel({ tab }: { tab: TerminalTab }): ReactElement {
  return (
    <span className="min-w-0 flex-1 truncate px-3 text-left" title={detailText(tab)}>
      {terminalTabLabel(tab)}
    </span>
  );
}

function TerminalTabDragOverlay({ tab }: { tab: TerminalTab }): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={cn(
        terminalTabShellClassName,
        "z-50 border-r border-(--dev-server-terminal-border) border-t-4 border-t-selected-accent bg-(--dev-server-terminal-tab-active) text-(--dev-server-terminal-foreground)",
      )}
    >
      <TerminalTabLabel tab={tab} />
    </div>
  );
}

function SortableTerminalTab({
  tab,
  isActiveDrag,
  shouldSuppressSelection,
  onSelectTab,
  onCloseTab,
}: {
  tab: TerminalTab;
  isActiveDrag: boolean;
  shouldSuppressSelection: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tab: TerminalTab) => void;
}): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.tabId,
    transition: horizontalTabSortTransition,
  });
  const isDragSource = isDragging || isActiveDrag;
  return (
    <div
      ref={setNodeRef}
      data-dragging={isDragSource ? "true" : "false"}
      className={cn(terminalTabShellClassName, isDragSource && "opacity-0")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
    >
      <TabsTrigger
        value={tab.tabId}
        aria-label={`${terminalTabLabel(tab)}, ${lifecycleText(tab)}`}
        className={cn(
          terminalTabTriggerClassName,
          "h-8 w-full max-w-none flex-1 cursor-pointer px-0 pr-8",
        )}
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          if (shouldSuppressSelection) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelectTab(tab.tabId);
        }}
      >
        <TerminalTabLabel tab={tab} />
      </TabsTrigger>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Close ${terminalTabLabel(tab)}`}
        aria-busy={terminalTabLifecycle(tab) === "closing"}
        className="absolute right-1 z-20 size-6 rounded-sm text-[var(--dev-server-terminal-foreground)] hover:bg-[var(--dev-server-terminal-surface)] hover:text-[var(--dev-server-terminal-foreground)]"
        disabled={terminalTabLifecycle(tab) === "closing"}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCloseTab(tab);
        }}
      >
        {terminalTabLifecycle(tab) === "closing" ? <Loader2 className="animate-spin" /> : <X />}
      </Button>
    </div>
  );
}

export function TerminalTabStrip({
  tabs,
  onSelectTab,
  onReorderTab,
  onCloseTab,
}: {
  tabs: TerminalTab[];
  onSelectTab: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => void;
  onCloseTab: (tab: TerminalTab) => void;
}): ReactElement {
  const tabIds = useMemo(() => tabs.map((tab) => tab.tabId), [tabs]);
  const {
    activeTabId,
    sensors,
    collisionDetection,
    measuring,
    modifiers,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    shouldSuppressSelection,
  } = useTerminalTabReorderDrag({ tabIds, onReorderTab });
  const activeDragTab = activeTabId
    ? (tabs.find((tab) => tab.tabId === activeTabId) ?? null)
    : null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={measuring}
      modifiers={modifiers}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <TabsList
          aria-label="Terminal tabs"
          className={cn(terminalTabsListClassName, "hide-scrollbar")}
        >
          {tabs.map((tab) => (
            <SortableTerminalTab
              key={tab.tabId}
              tab={tab}
              isActiveDrag={activeTabId === tab.tabId}
              shouldSuppressSelection={shouldSuppressSelection(tab.tabId)}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
            />
          ))}
        </TabsList>
      </SortableContext>
      <DragOverlay dropAnimation={horizontalTabDropAnimation} zIndex={40}>
        {activeDragTab ? <TerminalTabDragOverlay tab={activeDragTab} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
