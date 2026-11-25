import { parseElementKey } from "@openducktor/workflows";
import type { CanvasEdge } from "../model/canvas-graph";
import { type Box, unionBox } from "./canvas-geometry";
import type { EdgeRoute } from "./edge-routes";
import type { RevealTarget } from "./use-reveal-selection";

/**
 * What the canvas reveals for a selection: a state box with the boxes that its lines link, or the
 * label of a transition with its two boxes and the arrows that its entry unfolds. Other
 * selections reveal nothing.
 */
export const revealTarget = (
  selectionKey: string | null,
  boxes: ReadonlyMap<string, Box>,
  edges: readonly CanvasEdge[],
  routes: ReadonlyMap<string, EdgeRoute>,
  /** The arrows that the selected entry unfolds, which show its source states. */
  unfolded: readonly Box[] = [],
): RevealTarget | null => {
  if (selectionKey === null) return null;
  const { kind, id } = parseElementKey(selectionKey);
  if (kind === "state") {
    const box = boxes.get(id);
    if (!box) return null;
    const linked = edges.flatMap(({ source, target }) => {
      if (source === id) return [boxes.get(target)];
      return target === id ? [boxes.get(source)] : [];
    });
    return {
      selection: box,
      neighbours: unionBox([box, ...linked.filter((item) => item !== undefined)]),
    };
  }
  if (kind !== "event") return null;
  const edge = edges.find(({ data }) => data.eventIds.includes(id));
  const route = edge ? routes.get(edge.id) : undefined;
  if (!edge || !route) return null;
  const ends = [boxes.get(edge.source), boxes.get(edge.target)].filter(
    (item) => item !== undefined,
  );
  return {
    selection: route.labelBox,
    neighbours: unionBox([route.extent, ...ends, ...unfolded]),
  };
};
