// Chains: steps in a row on wide screens and in a column on phones, each with an arrow to the next.
import { defineDiagram } from "./define";
import type { Box, Diagram, EdgeOptions, EdgeSpec, ItemData, NodeSpec } from "./spec";

/** The canvas sizes of a chain, and the spaces between its boxes, with and without a label. */
const CHAIN = {
  wide: { width: 860, gap: 32, labeledGap: 72, loopOffset: 30 },
  narrow: { width: 320, gap: 32, labeledGap: 44, loopOffset: 24 },
  /** The room for a loop: under the row, and left of the column. */
  room: { bottom: 44, left: 40 },
  /** The space around the boxes, so their borders stay in the canvas. */
  inset: 1,
};

/** A step of a chain: an item, with its place in the row and the column. */
export type ChainStep<Id extends string> = ItemData & {
  id: Id;
  /** The width of the box in the row, relative to the other steps. 1 by default. */
  flex?: number;
  /** The height of the box in the column, when it differs from the other steps. */
  narrowHeight?: number;
  /** The options of the arrow to the next step, over the options of the chain. */
  next?: EdgeOptions;
};

export type ChainSpec<Id extends string> = {
  name: string;
  label: string;
  steps: readonly ChainStep<Id>[];
  /** The box heights in the row and in the column. */
  heights: { wide: number; narrow: number };
  /** The options of every arrow to the next step. */
  edge?: EdgeOptions;
  /** A labeled arrow back from a later step to an earlier one, under the row and left of the column. */
  loop?: { from: NoInfer<Id>; to: NoInfer<Id>; label: string };
};

/** Steps in a row on wide screens and in a column on phones, each with an arrow to the next. */
export function chainDiagram<Id extends string>({
  name,
  label,
  steps,
  heights,
  edge,
  loop,
}: ChainSpec<Id>): Diagram {
  const { inset, room } = CHAIN;
  const arrow = (step: ChainStep<Id>): EdgeOptions => ({ ...edge, ...step.next });
  const labeled = steps.slice(0, -1).some((step) => arrow(step).label);
  const wideGap = labeled ? CHAIN.wide.labeledGap : CHAIN.wide.gap;
  const narrowGap = labeled ? CHAIN.narrow.labeledGap : CHAIN.narrow.gap;
  const totalFlex = steps.reduce((sum, step) => sum + (step.flex ?? 1), 0);
  const rowWidth = CHAIN.wide.width - 2 * inset - wideGap * (steps.length - 1);
  const left = loop ? room.left : inset;

  const nodes: [string, NodeSpec][] = [];
  const wideBoxes: [string, Box][] = [];
  const narrowBoxes: [string, Box][] = [];
  let x = inset;
  let y = inset;
  for (const { id, flex = 1, narrowHeight = heights.narrow, next: _next, ...data } of steps) {
    nodes.push([id, { type: "item", data }]);
    const w = Math.floor((rowWidth * flex) / totalFlex);
    wideBoxes.push([id, { x, y: inset, w, h: heights.wide }]);
    narrowBoxes.push([id, { x: left, y, w: CHAIN.narrow.width - left - inset, h: narrowHeight }]);
    x += w + wideGap;
    y += narrowHeight + narrowGap;
  }

  const arrows = (out: string, into: string): EdgeSpec<string>[] =>
    steps.flatMap((step, index): EdgeSpec<string>[] => {
      const following = steps[index + 1];
      return following ? [[`${step.id}.${out}`, `${following.id}.${into}`, arrow(step)]] : [];
    });
  const back = (side: string, offset: number): EdgeSpec<string>[] =>
    loop
      ? [
          [
            `${loop.from}.${side}`,
            `${loop.to}.${side}`,
            { label: loop.label, step: true, still: true, offset },
          ],
        ]
      : [];

  return defineDiagram({
    name,
    label,
    nodes: Object.fromEntries(nodes),
    wide: {
      width: CHAIN.wide.width,
      height: heights.wide + 2 * inset + (loop ? room.bottom : 0),
      boxes: Object.fromEntries(wideBoxes),
      edges: [...arrows("r", "l"), ...back("b", CHAIN.wide.loopOffset)],
    },
    narrow: {
      width: CHAIN.narrow.width,
      height: y - narrowGap + inset,
      boxes: Object.fromEntries(narrowBoxes),
      edges: [...arrows("b", "t"), ...back("l", CHAIN.narrow.loopOffset)],
    },
  });
}
