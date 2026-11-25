import {
  TASK_CLOSED_STATE,
  type WorkflowCanvasLayout,
  type WorkflowDocumentDefinition,
} from "@openducktor/contracts";
import { columnOrder } from "@openducktor/workflows";
import { type CanvasLink, canvasLinks } from "./canvas-graph";

/** The size of a state box. The canvas draws boxes at this size. */
export const STATE_BOX_WIDTH = 240;
export const STATE_BOX_HEIGHT = 68;
/** The row gap without a line across it. */
const MIN_ROW_GAP = 48;
/** The row gap that one arrow crosses, with room for its label. */
const ARROW_ROW_GAP = 120;
/** The row gap that more than one arrow crosses, so their lanes and labels keep apart. */
const BUSY_ROW_GAP = 168;
/** The height of one stacked loop or entry label, with its gap. */
const STACKED_LABEL = 32;
/** The room that a loop and its label take at the right of a box. */
const LOOP_ROOM = 240;
/** The room that an entry and its label, with the source count, take at the left of a box. */
const ENTRY_ROOM = 380;

/** The column gap between a box and a box of a side trip, past the room of their loops and entries. */
const SIDE_GAP = 128;

type Definition = Pick<WorkflowDocumentDefinition, "states" | "events" | "actions">;

/**
 * The main column and its rows. Each forward link (an arrow or an entry from a state before its
 * target in board column order) can carry the main column. The longest chain of forward links
 * wins, so the column holds the most states in board order, but a side trip never joins it: a
 * state that a task leaves only to come back by an arrow, while the state before it also moves
 * straight past it. "Blocked" between "In progress" and "AI review" is a side trip. A state that
 * nothing moves into starts the column again, so a new workflow stays one column. Done comes last.
 */
const mainColumn = (definition: Definition, links: readonly CanvasLink[]) => {
  const ordered = columnOrder(definition.states).map(({ state }) => state.id);
  const column = new Map(ordered.map((id, place) => [id, place]));
  const ahead = new Map(ordered.map((id) => [id, new Set<string>()]));
  const reached = new Set<string>();
  const back = new Set<string>();
  for (const { kind, sources, target } of links) {
    if (kind === "loop") continue;
    for (const source of sources)
      if (column.get(source)! < column.get(target)!) {
        ahead.get(source)!.add(target);
        reached.add(target);
      } else if (kind === "arrow") back.add(`${source}\u0000${target}`);
  }
  const sideTrip = (from: string, to: string) =>
    back.has(`${to}\u0000${from}`) &&
    [...ahead.get(to)!].some((after) => ahead.get(from)!.has(after));
  // The longest chain from each state, from the last column back, and its next state.
  const length = new Map<string, number>();
  const next = new Map<string, string>();
  for (const id of [...ordered].reverse()) {
    let best: string | undefined;
    for (const to of ahead.get(id)!)
      if (
        !sideTrip(id, to) &&
        (best === undefined ||
          length.get(to)! > length.get(best)! ||
          (length.get(to) === length.get(best) && column.get(to)! < column.get(best)!))
      )
        best = to;
    length.set(id, best === undefined ? 1 : length.get(best)! + 1);
    if (best !== undefined) next.set(id, best);
  }
  const main = new Set<string>();
  for (const start of ordered)
    if (!reached.has(start))
      for (let id: string | undefined = start; id !== undefined; id = next.get(id)) main.add(id);
  if (column.has(TASK_CLOSED_STATE)) main.add(TASK_CLOSED_STATE);
  const rows = new Map<string, number>();
  for (const id of ordered) if (main.has(id)) rows.set(id, rows.size);
  // A side state sits in the row of the latest state that moves into it.
  const into = new Map<string, string[]>(ordered.map((id) => [id, []]));
  for (const [from, targets] of ahead) for (const to of targets) into.get(to)!.push(from);
  for (const id of ordered)
    if (!main.has(id))
      rows.set(id, Math.max(0, ...into.get(id)!.map((from) => rows.get(from) ?? 0)));
  return { ordered, main, rows };
};

/**
 * Places every state box from top to bottom in board column order, which fits the tall canvas of
 * the editor. The main column runs straight down, so an arrow back never turns the order over,
 * and a side trip sits at the right of the row that it leaves from, like a branch. Boxes keep room
 * for their loops and entries. Positions are the top-left corners in whole pixels.
 */
export const autoLayout = (definition: Definition): WorkflowCanvasLayout["states"] => {
  const links = canvasLinks(definition);
  const { ordered, main, rows: rowOf } = mainColumn(definition, links);
  const roomOf = (kind: "loop" | "entry") =>
    new Set(links.filter((link) => link.kind === kind).map(({ source }) => source));
  const looped = roomOf("loop");
  const entered = roomOf("entry");
  const rightRoom = (id: string) => (looped.has(id) ? LOOP_ROOM : 0);
  const leftRoom = (id: string) => (entered.has(id) ? ENTRY_ROOM : 0);
  // Each row: its main box at x 0, then its side boxes at the right, in column order.
  const xOf = new Map<string, number>();
  const rowEnd = new Map<number, number>();
  for (const id of ordered)
    if (main.has(id)) {
      xOf.set(id, 0);
      rowEnd.set(rowOf.get(id)!, STATE_BOX_WIDTH + rightRoom(id));
    }
  for (const id of ordered)
    if (!main.has(id)) {
      const row = rowOf.get(id)!;
      const x = (rowEnd.get(row) ?? -SIDE_GAP) + SIDE_GAP + leftRoom(id);
      xOf.set(id, x);
      rowEnd.set(row, x + STATE_BOX_WIDTH + rightRoom(id));
    }
  const rowCount = Math.max(0, ...rowOf.values()) + 1;
  // Each row gap holds the arrows that cross it, and the label stacks of the loops and the
  // entries that stick out of the boxes on both of its sides.
  const crossings = Array.from({ length: rowCount }, () => 0);
  // The labels that stack beside a box: those of its loops and entries. The arrows along a row
  // all pass between its boxes, so their labels stack there too.
  const stacks = new Map<string, number>();
  const along = Array.from({ length: rowCount }, () => 0);
  for (const { kind, source, target } of links) {
    if (kind !== "arrow") {
      stacks.set(source, (stacks.get(source) ?? 0) + 1);
      continue;
    }
    const [low, high] = [rowOf.get(source)!, rowOf.get(target)!].sort(
      (left, right) => left - right,
    );
    if (low === high) along[low!]! += 1;
    for (let gap = low!; gap < high!; gap += 1) crossings[gap]! += 1;
  }
  // How far the tallest label stack of a row sticks out above or below its boxes.
  const overhang = along.map((count, row) =>
    Math.max(
      0,
      ...[
        count,
        ...ordered.filter((id) => rowOf.get(id) === row).map((id) => stacks.get(id) ?? 0),
      ].map((labels) => (labels * STACKED_LABEL - STATE_BOX_HEIGHT) / 2),
    ),
  );
  const tops = [0];
  for (let gap = 0; gap < rowCount - 1; gap += 1) {
    const count = crossings[gap]!;
    const arrows = count === 0 ? MIN_ROW_GAP : count === 1 ? ARROW_ROW_GAP : BUSY_ROW_GAP;
    const height = Math.max(arrows, overhang[gap]! + overhang[gap + 1]! + 16);
    tops.push(tops[gap]! + STATE_BOX_HEIGHT + height);
  }
  const positions: WorkflowCanvasLayout["states"] = {};
  for (const id of ordered)
    positions[id] = { x: Math.round(xOf.get(id)!), y: Math.round(tops[rowOf.get(id)!]!) };
  return positions;
};

/** The row height that a new box keeps from the box above it. */
const NEW_STATE_ROW = 140;

/**
 * Where the box of a new state goes, as the positions that change: in the place of Done while
 * Done is the lowest box, and Done moves one row down, as on the board. Else below the lowest box,
 * so it covers no other box.
 */
export const placeNewState = (
  placed: WorkflowCanvasLayout["states"],
  stateId: string,
): WorkflowCanvasLayout["states"] => {
  const positions = Object.values(placed);
  if (positions.length === 0) return { [stateId]: { x: 0, y: 0 } };
  const lowest = Math.max(...positions.map(({ y }) => y));
  const done = placed[TASK_CLOSED_STATE];
  if (done !== undefined && done.y === lowest)
    return {
      [stateId]: done,
      [TASK_CLOSED_STATE]: { x: done.x, y: done.y + NEW_STATE_ROW },
    };
  return {
    [stateId]: { x: Math.min(...positions.map(({ x }) => x)), y: lowest + NEW_STATE_ROW },
  };
};

/** The opening positions of the states that the document does not place. */
export const missingPositions = (
  definition: Pick<WorkflowDocumentDefinition, "states" | "events" | "actions">,
  layout: WorkflowCanvasLayout,
): WorkflowCanvasLayout["states"] => {
  if (definition.states.every(({ id }) => Object.hasOwn(layout.states, id))) return {};
  const all = autoLayout(definition);
  return Object.fromEntries(
    Object.entries(all).filter(([id]) => !Object.hasOwn(layout.states, id)),
  );
};
