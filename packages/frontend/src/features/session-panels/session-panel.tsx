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
  useMemo,
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
import { tabLinkIds } from "@/components/ui/tab-link-ids";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { horizontalTabSortTransition } from "@/components/ui/use-horizontal-sortable-tabs";
import {
  TerminalRestartButton,
  TerminalStatusMessages,
  terminalTabLifecycle,
} from "@/features/terminals";
import { cn } from "@/lib/utils";
import {
  isToolTabKind,
  PANEL_NAMES,
  PANEL_TAB_KIND_RULES,
  type PanelId,
  type ToolTabKind,
} from "./panel-tab-kinds";
import type { ResolvedPanelTab } from "./session-panel-layout";
import { SessionPanelLauncher } from "./session-panel-launcher";
import { PanelTabBadgeView, PanelTabIcon } from "./session-panel-tab-icon";
import { type PanelTabPresentation, panelTabPresentation } from "./session-panel-tab-presentation";
import type { PanelDragData } from "./session-panel-drop";
import { useSessionPanelMoves } from "./session-panels-root";
import type { SessionPanelModel } from "./use-session-panels";
import { SessionTerminalSurface } from "./session-terminal-host";
import { useSessionViewVisit } from "../session-navigation/session-view-context";
import { SessionViewShownActivity } from "../session-navigation/session-view-visibility";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { MOTION_EASE_OUT } from "@/components/ui/motion";

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
  /** The page shows the panel. The session view shows and hides the content with it. */
  isShown?: boolean;
};

const OTHER_PANEL = { right: "bottom", bottom: "right" } satisfies Record<PanelId, PanelId>;

/** One panel of a session page: a tab strip and the selected tab content. */
export const SessionPanel = memo(function SessionPanel({
  model,
  toolTabs,
  isShown = true,
}: SessionPanelProps): ReactElement {
  // The content stays mounted with its kept view and hides with it, so a switch paints the panel
  // without a mount. Each visit gets fresh content, so its dialogs do not open again on return.
  const visit = useSessionViewVisit();
  const hasTerminalTabs = model.tabs.some((tab) => tab.kind === "terminal");
  const showsTerminalStatus = model.panel === "bottom" || hasTerminalTabs;
  return (
    <TooltipProvider>
      <Tabs
        value={model.selectedTabId ?? ""}
        onValueChange={model.onSelect}
        data-testid={`session-panel-${model.panel}`}
        className="flex h-full min-h-0 flex-col gap-0 overflow-hidden bg-card"
      >
        <SessionViewShownActivity key={visit}>
          {isShown && <SessionPanelTabStrip model={model} toolTabs={toolTabs} />}
        </SessionViewShownActivity>
        {showsTerminalStatus ? <TerminalStatusMessages terminals={model.terminals} /> : null}
        <SessionPanelBody model={model} toolTabs={toolTabs} isShown={isShown} visit={visit} />
      </Tabs>
    </TooltipProvider>
  );
});

function SessionPanelBody({
  model,
  toolTabs,
  isShown,
  visit,
}: {
  model: SessionPanelModel;
  toolTabs: ToolTabViews | undefined;
  isShown: boolean;
  visit: number;
}): ReactElement {
  // A panel that slides out after its last tab closed keeps its empty area blank.
  const isEmpty = model.tabs.length === 0 && model.presence !== "closing";
  const isLoadingEmptyBottom = isEmpty && model.panel === "bottom" && model.terminals.isLoading;
  // The terminal host keeps a surface only while its model stays the same object.
  const surfaceModel = useMemo(
    () => (isShown || !model.isVisible ? model : { ...model, isVisible: false }),
    [isShown, model],
  );
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <SessionViewShownActivity key={visit}>
        {isShown &&
          model.tabs.map((tab) => (
            <PanelTabContent
              key={tab.id}
              tab={tab}
              isSelected={tab.id === model.selectedTabId}
              model={model}
              toolTabs={toolTabs}
            />
          ))}
        {isShown && isEmpty && !isLoadingEmptyBottom ? (
          <SessionPanelLauncher entries={model.launcher} onPick={model.onPick} />
        ) : null}
        {isShown && isLoadingEmptyBottom ? (
          <p
            role="status"
            className="flex h-full items-center justify-center text-sm text-muted-foreground"
          >
            Loading terminals...
          </p>
        ) : null}
      </SessionViewShownActivity>
      <SessionTerminalSurface model={surfaceModel} />
    </div>
  );
}

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
  const ids = tabLinkIds(model.tabIdBase, tab.id).content;
  if (tab.kind === "new_tab") {
    return (
      <TabsContent value={tab.id} {...ids} className={className}>
        <SessionPanelLauncher entries={model.launcher} onPick={model.onPick} />
      </TabsContent>
    );
  }
  const content =
    tab.kind === "browser"
      ? (model.browserTabView?.({
          tab,
          // A closed panel keeps its content mounted but hides it, so the page shows no surface.
          isShown: isSelected && model.presence !== "closed",
          addressFocusRequest: addressFocusRequestOf(model, tab),
        }) ?? null)
      : (toolTabs?.[tab.kind]?.content ?? null);
  if (PANEL_TAB_KIND_RULES[tab.kind].keepMounted) {
    return (
      <TabsContent value={tab.id} {...ids} forceMount hidden={!isSelected} className={className}>
        {content}
      </TabsContent>
    );
  }
  return (
    <TabsContent value={tab.id} {...ids} className={className}>
      {content}
    </TabsContent>
  );
}

/** The address bar focus request of a browser tab, or zero for any other tab. */
const addressFocusRequestOf = (model: SessionPanelModel, tab: ResolvedPanelTab): number =>
  tab.kind === "browser" && model.browserAddressFocus?.tabId === tab.entry.tabId
    ? model.browserAddressFocus.request
    : 0;

function SessionPanelTabStrip({ model, toolTabs }: SessionPanelProps): ReactElement {
  const hostClient = useHostClient();
  const stripData: PanelDragData = { type: "strip", panel: model.panel };
  const { setNodeRef } = useDroppable({ id: `strip:${model.panel}`, data: stripData });
  const dropState = useSessionPanelMoves().dropState(model.panel);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!model.selectedTabId) return;
    const selected = scrollRef.current?.querySelector<HTMLElement>(
      '[data-panel-tab][data-selected="true"]',
    );
    if (!selected) return;
    const reveal = () => selected.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    reveal();
    // A tab label can grow after the selection, such as when a new page loads its title.
    const observer = new ResizeObserver(reveal);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [model.selectedTabId]);
  const scrollEdges = useScrollEdges(scrollRef);
  const dropGaps = useDropGaps(model.panel, model.tabs);
  const panelName = PANEL_NAMES[model.panel];
  const controller = model.terminals.controller;
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
                view={isToolTabKind(tab.kind) ? toolTabs?.[tab.kind] : undefined}
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
      {controller &&
        model.tabs.map((tab) =>
          tab.kind === "terminal" && tab.terminal.terminalId ? (
            <TerminalRestartButton
              key={tab.terminal.terminalId}
              summary={tab.terminal.summary}
              controller={controller}
              onRestart={hostClient.terminalRestart}
              isVisible={tab.id === model.selectedTabId}
            />
          ) : null,
        )}
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

const DROP_GAP_TRANSITION = `transform 180ms ${MOTION_EASE_OUT}`;

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
            idBase={model.tabIdBase}
            presentation={presentation}
            view={view}
            isSelected={isSelected}
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

const PROMPTS_DESCRIPTION = "waits for your answer";

function SessionPanelTabTrigger({
  entryId,
  idBase,
  presentation,
  view,
  isSelected,
  tooltipSide,
}: {
  entryId: string;
  /** The ID base of the panel. A terminal content renders under another `Tabs` root. */
  idBase: string;
  presentation: PanelTabPresentation;
  view: ToolTabView | undefined;
  isSelected: boolean;
  /** The tooltip opens away from the page edge of the panel. */
  tooltipSide: "top" | "bottom";
}): ReactElement {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  // The tooltip shows the full label when the tab cuts it off, and it always shows a tooltip text
  // such as a page URL. It stays mounted, so the tab keeps its focus when its label changes.
  const [isTooltipOpen, setTooltipOpen] = useState(false);
  const onTooltipOpenChange = (open: boolean): void => {
    const label = labelRef.current;
    const isLabelCut = label !== null && label.scrollWidth > label.clientWidth;
    setTooltipOpen(open && (presentation.tooltip !== null || isLabelCut));
  };
  // A selected tab shows its prompts in its content, so only another tab needs the mark.
  const showsPromptMark = presentation.hasPrompts && !isSelected;
  const ariaLabel = view?.ariaLabel ?? presentation.ariaLabel;
  return (
    <Tooltip open={isTooltipOpen} onOpenChange={onTooltipOpenChange}>
      <TooltipTrigger asChild>
        <TabsTrigger
          value={entryId}
          {...tabLinkIds(idBase, entryId).trigger}
          aria-label={showsPromptMark ? `${ariaLabel}, ${PROMPTS_DESCRIPTION}` : ariaLabel}
          className="h-7 min-w-0 flex-1 cursor-pointer justify-start gap-1.5 rounded-md border-0 bg-transparent py-0 pr-7 pl-2 text-xs font-medium text-inherit shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none"
        >
          <PanelTabIcon presentation={presentation} showsPromptMark={showsPromptMark}>
            {view?.indicator}
          </PanelTabIcon>
          <span ref={labelRef} className="min-w-0 truncate">
            {presentation.label}
          </span>
          {presentation.badge ? <PanelTabBadgeView badge={presentation.badge} /> : null}
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-80 break-words">
        {presentation.label}
        {presentation.tooltip ? (
          <span className="block whitespace-pre-line opacity-80">{presentation.tooltip}</span>
        ) : null}
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
