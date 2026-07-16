import { DndContext, type DraggableSyntheticListeners, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, X } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type RefCallback,
  useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { AgentStudioTerminalTab } from "@/pages/agents/terminals/use-agent-studio-terminals";
import { terminalTabsListClassName, terminalTabTriggerClassName } from "../terminal-tab-styles";
import {
  horizontalTabDropAnimation,
  horizontalTabSortTransition,
} from "../use-horizontal-sortable-tabs";
import { useTerminalTabReorderDrag } from "./use-terminal-tab-reorder-drag";

const lifecycleText = (tab: AgentStudioTerminalTab): string => {
  if (tab.requestState === "creating") return "Creating";
  if (tab.requestState === "unsupported_runtime") return "Unsupported runtime";
  if (tab.requestState === "creation_failed") return "Creation failed";
  if (tab.requestState === "lost") return "Lost after host restart";
  if (tab.lifecycle === "starting") return "Starting";
  if (tab.lifecycle === "closing") return "Closing";
  if (tab.lifecycle === "close_failed") return "Close failed";
  if (tab.lifecycle === "exited") return "Exited";
  return "Running";
};

const detailText = (tab: AgentStudioTerminalTab): string =>
  tab.summary
    ? `${lifecycleText(tab)}. Started in ${tab.summary.initialWorkingDir}`
    : lifecycleText(tab);

type TerminalTabShellProps = {
  tab: AgentStudioTerminalTab;
  dragListeners?: DraggableSyntheticListeners;
  shellRef?: RefCallback<HTMLDivElement>;
  style?: CSSProperties;
  isDragSource?: boolean;
  isDragOverlay?: boolean;
  shouldSuppressSelection?: boolean;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tab: AgentStudioTerminalTab) => void;
};

function TerminalTabShell({
  tab,
  dragListeners,
  shellRef,
  style,
  isDragSource = false,
  isDragOverlay = false,
  shouldSuppressSelection = false,
  onSelectTab,
  onCloseTab,
}: TerminalTabShellProps): ReactElement {
  const label = (
    <span className="min-w-0 flex-1 truncate px-3 text-left" title={detailText(tab)}>
      {tab.label}
    </span>
  );
  return (
    <div
      ref={shellRef}
      style={style}
      data-dragging={isDragSource ? "true" : "false"}
      className={cn(
        "group relative inline-flex h-8 min-w-52 max-w-80 shrink-0 touch-none select-none items-center",
        isDragSource && "opacity-0",
        isDragOverlay &&
          "z-50 border-r border-(--dev-server-terminal-border) border-t-4 border-t-selected-accent bg-(--dev-server-terminal-tab-active) text-(--dev-server-terminal-foreground)",
      )}
      {...dragListeners}
    >
      {isDragOverlay ? (
        label
      ) : (
        <TabsTrigger
          value={tab.tabId}
          aria-label={`${tab.label}, ${lifecycleText(tab)}`}
          className={cn(terminalTabTriggerClassName, "h-8 w-full max-w-none flex-1 px-0 pr-8")}
          onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
          onMouseUp={(event: ReactMouseEvent<HTMLButtonElement>) => {
            if (shouldSuppressSelection) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            onSelectTab?.(tab.tabId);
          }}
        >
          {label}
        </TabsTrigger>
      )}
      {isDragOverlay ? null : (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Close ${tab.label}`}
          aria-busy={tab.lifecycle === "closing"}
          className="absolute right-1 z-20 size-6 rounded-sm text-[var(--dev-server-terminal-foreground)] hover:bg-[var(--dev-server-terminal-surface)] hover:text-[var(--dev-server-terminal-foreground)]"
          disabled={tab.lifecycle === "closing"}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCloseTab?.(tab);
          }}
        >
          {tab.lifecycle === "closing" ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      )}
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
  tab: AgentStudioTerminalTab;
  isActiveDrag: boolean;
  shouldSuppressSelection: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tab: AgentStudioTerminalTab) => void;
}): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.tabId,
    transition: horizontalTabSortTransition,
  });
  return (
    <TerminalTabShell
      tab={tab}
      shellRef={setNodeRef}
      dragListeners={listeners}
      isDragSource={isDragging || isActiveDrag}
      shouldSuppressSelection={shouldSuppressSelection}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    />
  );
}

export function TerminalTabStrip({
  tabs,
  onSelectTab,
  onReorderTab,
  onCloseTab,
}: {
  tabs: AgentStudioTerminalTab[];
  onSelectTab: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => void;
  onCloseTab: (tab: AgentStudioTerminalTab) => void;
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
          aria-label="Task terminal tabs"
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
        {activeDragTab ? <TerminalTabShell tab={activeDragTab} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
