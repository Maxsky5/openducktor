import {
  type CollisionDetection,
  closestCenter,
  type DataRef,
  type DragEndEvent,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import type { PanelId } from "./panel-tab-kinds";
import type { PanelDropTarget } from "./session-panel-layout";

/** The data that each tab and each tab strip gives to drag and drop. */
export type PanelDragData = { type: "tab"; panel: PanelId } | { type: "strip"; panel: PanelId };

export type PanelDrop = { entryId: string; from: PanelId; to: PanelId; target: PanelDropTarget };

export type ActiveDrag = { entryId: string; from: PanelId; drop: PanelDrop | null };

export type PanelTabIds = Record<PanelId, readonly string[]>;

export type DropFeedback = {
  /** The other panel under the dragged tab. */
  panel: PanelId | null;
  isAllowed: boolean;
  /** Where the tab lands in the other panel, when that panel allows it. */
  target: PanelDropTarget;
};

/** Reads the data that a session panel tab or strip gave to dnd-kit. */
export const dragData = (data: DataRef | undefined): PanelDragData | null => {
  const type = data?.current?.type;
  const panel = data?.current?.panel;
  if ((type !== "tab" && type !== "strip") || (panel !== "right" && panel !== "bottom"))
    return null;
  return { type, panel };
};

/**
 * Finds the tab strip under the pointer, or under the dragged tab, then the closest tab in it. A
 * drop outside both strips does nothing.
 */
export const panelCollisionDetection: CollisionDetection = (args) => {
  const strips = args.droppableContainers.filter(
    (container) => dragData(container.data)?.type === "strip",
  );
  const pointerStrips = pointerWithin({ ...args, droppableContainers: strips });
  const strip = (
    pointerStrips.length > 0
      ? pointerStrips
      : rectIntersection({ ...args, droppableContainers: strips })
  )[0];
  if (!strip) return [];
  const panel = dragData(strips.find((container) => container.id === strip.id)?.data)?.panel;
  const tabs = args.droppableContainers.filter((container) => {
    const data = dragData(container.data);
    return data?.type === "tab" && data.panel === panel;
  });
  const tab = closestCenter({ ...args, droppableContainers: tabs })[0];
  return [tab ?? strip];
};

export const sameDrop = (left: PanelDrop | null, right: PanelDrop | null): boolean =>
  left?.to === right?.to &&
  left?.target?.id === right?.target?.id &&
  left?.target?.position === right?.target?.position;

/**
 * The panel and place where the dragged tab lands if the user drops it now. In its own panel the
 * tab takes the place of the target. In the other panel it goes before or after the target, by the
 * side of the target center that the dragged tab center is on.
 */
export const resolvePanelDrop = (
  event: Pick<DragEndEvent, "active" | "over">,
  tabIds: PanelTabIds,
): PanelDrop | null => {
  const from = dragData(event.active.data)?.panel;
  const over = event.over;
  const target = dragData(over?.data);
  if (!from || !over || !target) return null;
  const entryId = String(event.active.id);
  if (target.type === "strip") return { entryId, from, to: target.panel, target: null };
  const targetId = String(over.id);
  if (targetId === entryId) return null;
  let position: "before" | "after";
  if (from === target.panel) {
    const ids = tabIds[from];
    position = ids.indexOf(entryId) < ids.indexOf(targetId) ? "after" : "before";
  } else {
    const dragged = event.active.rect.current.translated;
    const draggedCenter = dragged ? dragged.left + dragged.width / 2 : 0;
    position = draggedCenter > over.rect.left + over.rect.width / 2 ? "after" : "before";
  }
  return { entryId, from, to: target.panel, target: { id: targetId, position } };
};

const NO_DROP_FEEDBACK: DropFeedback = { panel: null, isAllowed: false, target: null };

/** Tells the other panel under the dragged tab whether it accepts the tab, and where it lands. */
export const dropFeedback = (
  activeDrag: ActiveDrag | null,
  canMove: (entryId: string, to: PanelId) => boolean,
): DropFeedback => {
  const drop = activeDrag?.drop;
  if (!drop || drop.to === activeDrag.from) return NO_DROP_FEEDBACK;
  const isAllowed = canMove(drop.entryId, drop.to);
  return { panel: drop.to, isAllowed, target: isAllowed ? drop.target : null };
};
