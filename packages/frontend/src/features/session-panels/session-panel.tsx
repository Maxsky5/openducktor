import { useDndContext, useDroppable } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2, Plus, X } from "lucide-react";
import {
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { horizontalTabSortTransition } from "@/components/ui/use-horizontal-sortable-tabs";
import { TerminalLayer, TerminalStatusMessages, terminalTabLifecycle } from "@/features/terminals";
import { cn } from "@/lib/utils";
import {
  PANEL_NAMES,
  PANEL_TAB_KIND_RULES,
  type PanelId,
  type ToolTabKind,
} from "./panel-tab-kinds";
import type { ResolvedPanelTab } from "./session-panel-layout";
import { SessionPanelLauncher } from "./session-panel-launcher";
import { type PanelTabPresentation, panelTabPresentation } from "./session-panel-tab-presentation";
import type { PanelDragData } from "./session-panel-drop";
import { useSessionPanelMoves } from "./session-panels-root";
import type { SessionPanelModel } from "./use-session-panels";

/** The content and tab decorations that a page gives for one tool tab kind. */
export type ToolTabView = {
  content: ReactNode;
  /** Replaces the kind label as the accessible name, for example to add a status. */
  ariaLabel?: string | undefined;
  /** Renders over the tab icon. */
  indicator?: ReactNode;
};

export type ToolTabViews = Partial<Record<ToolTabKind, ToolTabView>>;

type SessionPanelProps = {
  model: SessionPanelModel;
  toolTabs?: ToolTabViews | undefined;
};

const OTHER_PANEL = { right: "bottom", bottom: "right" } satisfies Record<PanelId, PanelId>;

/** One panel of a session page: a tab strip and the selected tab content. */
export const SessionPanel = memo(function SessionPanel({
  model,
  toolTabs,
}: SessionPanelProps): ReactElement {
  const hasTerminalTabs = model.tabs.some((tab) => tab.kind === "terminal");
  const showsTerminalStatus = model.panel === "bottom" || hasTerminalTabs;
  // A panel that slides out after its last tab closed keeps its empty area blank.
  const isEmpty = model.tabs.length === 0 && model.presence !== "closing";
  const isLoadingEmptyBottom = isEmpty && model.panel === "bottom" && model.terminals.isLoading;
  return (
    <TooltipProvider>
      <Tabs
        value={model.selectedTabId ?? ""}
        onValueChange={model.onSelect}
        data-testid={`session-panel-${model.panel}`}
        className="flex h-full min-h-0 flex-col gap-0 overflow-hidden bg-card"
      >
        <SessionPanelTabStrip model={model} toolTabs={toolTabs} />
        {showsTerminalStatus ? <TerminalStatusMessages terminals={model.terminals} /> : null}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {model.tabs.map((tab) => (
            <PanelTabContent
              key={tab.id}
              tab={tab}
              isSelected={tab.id === model.selectedTabId}
              model={model}
              toolTabs={toolTabs}
            />
          ))}
          {isEmpty && !isLoadingEmptyBottom ? (
            <SessionPanelLauncher entries={model.launcher} onPick={model.onPick} />
          ) : null}
          {isLoadingEmptyBottom ? (
            <p
              role="status"
              className="flex h-full items-center justify-center text-sm text-muted-foreground"
            >
              Loading terminals...
            </p>
          ) : null}
          <TerminalLayer
            terminals={model.terminals}
            mounts={model.terminalMounts}
            activeKey={model.activeTerminalKey}
            isVisible={model.isVisible}
            focusRequest={model.focusRequest}
          />
        </div>
      </Tabs>
    </TooltipProvider>
  );
});

function PanelTabContent({
  tab,
  isSelected,
  model,
  toolTabs,
}: {
  tab: ResolvedPanelTab;
  isSelected: boolean;
  model: SessionPanelModel;
  toolTabs: ToolTabViews | undefined;
}): ReactElement | null {
  if (tab.kind === "terminal") return null;
  const className = "h-full min-h-0 overflow-hidden data-[state=inactive]:hidden";
  if (tab.kind === "new_tab") {
    return (
      <TabsContent value={tab.id} className={className}>
        <SessionPanelLauncher entries={model.launcher} onPick={model.onPick} />
      </TabsContent>
    );
  }
  const content = toolTabs?.[tab.kind]?.content ?? null;
  if (PANEL_TAB_KIND_RULES[tab.kind].keepMounted) {
    return (
      <TabsContent value={tab.id} forceMount hidden={!isSelected} className={className}>
        {content}
      </TabsContent>
    );
  }
  return (
    <TabsContent value={tab.id} className={className}>
      {content}
    </TabsContent>
  );
}

function SessionPanelTabStrip({ model, toolTabs }: SessionPanelProps): ReactElement {
  const stripData: PanelDragData = { type: "strip", panel: model.panel };
  const { setNodeRef } = useDroppable({ id: `strip:${model.panel}`, data: stripData });
  const dropState = useSessionPanelMoves().dropState(model.panel);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!model.selectedTabId) return;
    scrollRef.current
      ?.querySelector<HTMLElement>('[data-panel-tab][data-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [model.selectedTabId]);
  const scrollEdges = useScrollEdges(scrollRef);
  const dropGaps = useDropGaps(model.panel, model.tabs);
  const panelName = PANEL_NAMES[model.panel];
  return (
    <div
      ref={setNodeRef}
      data-drop={dropState ?? undefined}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-1",
        dropState === "accepted" && "bg-primary/5 ring-2 ring-primary/40 ring-inset",
        dropState === "rejected" &&
          "cursor-not-allowed bg-destructive/5 ring-2 ring-destructive/40 ring-inset",
      )}
    >
      {model.onHide ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="shrink-0 md:hidden"
          onClick={model.onHide}
        >
          Back to workspace
        </Button>
      ) : null}
      <div
        ref={scrollRef}
        className="hide-scrollbar min-w-0 overflow-x-auto"
        style={{ maskImage: edgeFadeMask(scrollEdges) }}
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs, as in browser tab strips.
          const strip = event.currentTarget;
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) strip.scrollLeft += event.deltaY;
        }}
      >
        <SortableContext
          items={model.tabs.map((tab) => tab.id)}
          strategy={horizontalListSortingStrategy}
        >
          <TabsList
            aria-label={`${panelName[0]?.toUpperCase()}${panelName.slice(1)} tabs`}
            className="h-7 w-max justify-start gap-1 rounded-none bg-transparent px-0.5 py-0"
          >
            {model.tabs.map((tab, index) => (
              <SessionPanelTab
                key={tab.id}
                tab={tab}
                panel={model.panel}
                dropGap={dropGaps[index] ?? 0}
                isSelected={tab.id === model.selectedTabId}
                view={
                  tab.kind === "terminal" || tab.kind === "new_tab"
                    ? undefined
                    : toolTabs?.[tab.kind]
                }
                model={model}
              />
            ))}
          </TabsList>
        </SortableContext>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`New tab in the ${panelName}`}
            onClick={model.onAddTab}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New tab</TooltipContent>
      </Tooltip>
      {dropState === "rejected" ? (
        <span role="status" className="sr-only">
          This tab cannot move to the {panelName}.
        </span>
      ) : null}
    </div>
  );
}

type ScrollEdges = { start: boolean; end: boolean };

/** Tells which ends of a horizontal scroll area have hidden content. */
function useScrollEdges(scrollRef: RefObject<HTMLDivElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useLayoutEffect(() => {
    const strip = scrollRef.current;
    if (!strip) return;
    const update = (): void => {
      const start = strip.scrollLeft > 0;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setEdges((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(strip);
    if (strip.firstElementChild) resize.observe(strip.firstElementChild);
    return () => {
      strip.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [scrollRef]);
  return edges;
}

const FADE = "1.25rem";

const edgeFadeMask = ({ start, end }: ScrollEdges): string | undefined => {
  if (!start && !end) return undefined;
  const from = start ? `transparent, black ${FADE}` : "black";
  const to = end ? `black calc(100% - ${FADE}), transparent` : "black";
  return `linear-gradient(to right, ${from}, ${to})`;
};

const DROP_GAP_TRANSITION = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";

const dropGapTransform = (gap: number): string | undefined =>
  gap > 0 ? `translateX(${gap}px)` : undefined;

/**
 * The space that opens in front of each tab while a tab from the other panel hovers over the strip,
 * so the user sees where it lands.
 */
function useDropGaps(panel: PanelId, tabs: readonly ResolvedPanelTab[]): readonly number[] {
  const marker = useSessionPanelMoves().dropMarker(panel);
  const { active } = useDndContext();
  const width = active?.rect.current.initial?.width ?? 0;
  const targetIndex = marker ? tabs.findIndex((tab) => tab.id === marker.id) : -1;
  if (!marker || targetIndex < 0 || width === 0) return tabs.map(() => 0);
  const insertIndex = marker.position === "after" ? targetIndex + 1 : targetIndex;
  // The gap is the dragged tab plus the strip gap of 0.25rem.
  return tabs.map((_tab, index) => (index >= insertIndex ? width + 4 : 0));
}

function SessionPanelTab({
  tab,
  panel,
  isSelected,
  view,
  model,
  dropGap,
}: {
  tab: ResolvedPanelTab;
  panel: PanelId;
  isSelected: boolean;
  view: ToolTabView | undefined;
  model: SessionPanelModel;
  dropGap: number;
}): ReactElement {
  const tabData: PanelDragData = { type: "tab", panel };
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: tabData,
    transition: horizontalTabSortTransition,
  });
  const presentation = panelTabPresentation(tab);
  const otherPanel = OTHER_PANEL[panel];
  const moves = useSessionPanelMoves();
  const canMoveToOtherPanel = moves.canMove(tab.id, otherPanel);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          data-panel-tab
          data-selected={isSelected ? "true" : "false"}
          data-dragging={isDragging ? "true" : "false"}
          className={cn(
            "group relative inline-flex h-7 max-w-48 min-w-0 shrink-0 touch-none select-none items-center rounded-md transition-colors",
            isSelected
              ? "bg-muted text-foreground ring-1 ring-border ring-inset"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            isDragging && "opacity-0",
          )}
          style={{
            transform: CSS.Transform.toString(transform) ?? dropGapTransform(dropGap),
            transition: transition ?? DROP_GAP_TRANSITION,
          }}
          {...listeners}
        >
          <SessionPanelTabTrigger
            entryId={tab.id}
            presentation={presentation}
            view={view}
            tooltipSide={panel === "bottom" ? "top" : "bottom"}
          />
          <SessionPanelTabCloseButton
            label={presentation.label}
            isSelected={isSelected}
            isClosing={tab.kind === "terminal" && terminalTabLifecycle(tab.terminal) === "closing"}
            onClose={() => model.onClose(tab.id)}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canMoveToOtherPanel ? (
          <>
            <ContextMenuItem onSelect={() => moves.onMove(tab.id, otherPanel)}>
              Move to {PANEL_NAMES[otherPanel]}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onSelect={() => model.onClose(tab.id)}>Close tab</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionPanelTabTrigger({
  entryId,
  presentation,
  view,
  tooltipSide,
}: {
  entryId: string;
  presentation: PanelTabPresentation;
  view: ToolTabView | undefined;
  /** The tooltip opens away from the page edge of the panel. */
  tooltipSide: "top" | "bottom";
}): ReactElement {
  const Icon = presentation.icon;
  const labelRef = useRef<HTMLSpanElement | null>(null);
  // The tooltip shows the full label only when the tab cuts it off. It stays mounted, so the tab
  // keeps its focus when its label changes.
  const [isTooltipOpen, setTooltipOpen] = useState(false);
  const onTooltipOpenChange = (open: boolean): void => {
    const label = labelRef.current;
    setTooltipOpen(open && label !== null && label.scrollWidth > label.clientWidth);
  };
  return (
    <Tooltip open={isTooltipOpen} onOpenChange={onTooltipOpenChange}>
      <TooltipTrigger asChild>
        <TabsTrigger
          value={entryId}
          aria-label={view?.ariaLabel ?? presentation.ariaLabel}
          className="h-7 min-w-0 flex-1 cursor-pointer justify-start gap-1.5 rounded-md border-0 bg-transparent py-0 pr-7 pl-2 text-xs font-medium text-inherit shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none"
        >
          <span className="relative inline-flex shrink-0">
            <Icon className="size-3.5" aria-hidden="true" />
            {view?.indicator}
          </span>
          <span ref={labelRef} className="min-w-0 truncate">
            {presentation.label}
          </span>
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-80 break-words">
        {presentation.label}
      </TooltipContent>
    </Tooltip>
  );
}

function SessionPanelTabCloseButton({
  label,
  isSelected,
  isClosing,
  onClose,
}: {
  label: string;
  isSelected: boolean;
  isClosing: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={`Close ${label}`}
      aria-busy={isClosing}
      disabled={isClosing}
      className={cn(
        "absolute right-1 size-5 rounded-sm text-muted-foreground opacity-0 hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
        (isSelected || isClosing) && "opacity-100",
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {isClosing ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <X className="size-3" aria-hidden="true" />
      )}
    </Button>
  );
}
