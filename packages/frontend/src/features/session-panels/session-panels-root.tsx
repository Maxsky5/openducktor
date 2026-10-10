import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Ban } from "lucide-react";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import {
  horizontalTabDropAnimation,
  useTabDragSensors,
} from "@/components/ui/use-horizontal-sortable-tabs";
import { TerminalCloseDialog } from "@/features/terminals";
import type { PanelId } from "./panel-tab-kinds";
import {
  type ActiveDrag,
  dragData,
  dropFeedback,
  type PanelTabIds,
  panelCollisionDetection,
  resolvePanelDrop,
  sameDrop,
} from "./session-panel-drop";
import type { PanelDropTarget, ResolvedPanelTab } from "./session-panel-layout";
import { panelTabPresentation } from "./session-panel-tab-presentation";
import type { SessionPanelsModel } from "./use-session-panels";

export type PanelDropState = "accepted" | "rejected" | null;

type SessionPanelMoves = {
  dropState: (panel: PanelId) => PanelDropState;
  /** Where a tab from the other panel lands in this panel, so the strip can open a gap there. */
  dropMarker: (panel: PanelId) => PanelDropTarget;
  canMove: SessionPanelsModel["canMove"];
  onMove: SessionPanelsModel["onMove"];
};

const SessionPanelMovesContext = createContext<SessionPanelMoves>({
  dropState: () => null,
  dropMarker: () => null,
  canMove: () => false,
  onMove: () => {},
});

/** The drag and drop state and the moves between the panels of the page. */
export const useSessionPanelMoves = (): SessionPanelMoves => use(SessionPanelMovesContext);

/** The chip that follows the pointer while the user drags a tab. */
function PanelTabDragPreview({
  tab,
  isRejected,
}: {
  tab: ResolvedPanelTab;
  isRejected: boolean;
}): ReactElement {
  const { icon: Icon, label } = panelTabPresentation(tab);
  return (
    <div
      aria-hidden="true"
      className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 text-xs font-medium text-foreground shadow-md backdrop-blur-[1px]"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {isRejected ? <Ban className="size-3.5 shrink-0 text-destructive" /> : null}
    </div>
  );
}

/**
 * Gives both session panels one drag and drop context, so a terminal tab can move between them.
 * It also renders the terminal close confirmation of the page.
 */
export function SessionPanelsRoot({
  panels,
  children,
}: {
  panels: SessionPanelsModel;
  children: ReactNode;
}): ReactElement {
  const sensors = useTabDragSensors();
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const { right, bottom, canMove, onMove, onDrop, platformError } = panels;

  useEffect(() => {
    if (!platformError) return;
    const toastId = "terminal:platform";
    toast.error("Terminal shortcuts unavailable", { id: toastId, description: platformError });
    return () => {
      toast.dismiss(toastId);
    };
  }, [platformError]);

  const tabIds = useMemo<PanelTabIds>(
    () => ({
      right: right.tabs.map((tab) => tab.id),
      bottom: bottom.tabs.map((tab) => tab.id),
    }),
    [bottom.tabs, right.tabs],
  );
  const endDrag = useCallback((): void => setActiveDrag(null), []);
  const handleDragStart = useCallback((event: DragStartEvent): void => {
    const from = dragData(event.active.data)?.panel;
    if (from) setActiveDrag({ entryId: String(event.active.id), from, drop: null });
  }, []);
  const handleDragMove = useCallback(
    (event: DragMoveEvent): void => {
      const drop = resolvePanelDrop(event, tabIds);
      setActiveDrag((current) =>
        current && !sameDrop(current.drop, drop) ? { ...current, drop } : current,
      );
    },
    [tabIds],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      endDrag();
      const drop = resolvePanelDrop(event, tabIds);
      if (drop) onDrop(drop.entryId, drop.to, drop.target);
    },
    [endDrag, onDrop, tabIds],
  );

  const {
    panel: dropTargetPanel,
    isAllowed: dropAllowed,
    target: markerTarget,
  } = dropFeedback(activeDrag, canMove);
  const moves = useMemo<SessionPanelMoves>(
    () => ({
      dropState: (panel) => {
        if (panel !== dropTargetPanel) return null;
        return dropAllowed ? "accepted" : "rejected";
      },
      dropMarker: (panel) => (panel === dropTargetPanel ? markerTarget : null),
      canMove,
      onMove,
    }),
    [canMove, dropAllowed, dropTargetPanel, markerTarget, onMove],
  );
  const draggedTab = activeDrag
    ? [...right.tabs, ...bottom.tabs].find((tab) => tab.id === activeDrag.entryId)
    : undefined;

  return (
    <SessionPanelMovesContext value={moves}>
      <DndContext
        sensors={sensors}
        collisionDetection={panelCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={endDrag}
      >
        {children}
        <DragOverlay dropAnimation={horizontalTabDropAnimation} zIndex={60}>
          {draggedTab ? (
            <PanelTabDragPreview
              tab={draggedTab}
              isRejected={dropTargetPanel !== null && !dropAllowed}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <TerminalCloseDialog model={panels.terminalClose} />
    </SessionPanelMovesContext>
  );
}
