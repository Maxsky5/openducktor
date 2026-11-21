import { describe, expect, test } from "bun:test";
import { type Box, boxesOverlap } from "./canvas-geometry";
import { arrowSides, type RoutedLink, routeLinks } from "./edge-routes";

const box = (x: number, y: number): Box => ({ x, y, width: 240, height: 68 });
const arrow = (source: string, target: string, text = "Start"): RoutedLink => ({
  id: `${source}-${target}`,
  kind: "arrow",
  source,
  target,
  text,
  labelled: true,
});

/** The corner points of a path: the start and every `L` target. */
const pathPoints = (path: string) =>
  [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({
    x: Number(x),
    y: Number(y),
  }));

describe("arrow sides", () => {
  test("the sides face the other box along the axis with the larger gap", () => {
    expect(arrowSides(box(0, 0), box(0, 200))).toEqual(["bottom", "top"]);
    expect(arrowSides(box(0, 200), box(0, 0))).toEqual(["top", "bottom"]);
    expect(arrowSides(box(0, 0), box(400, 20))).toEqual(["right", "left"]);
    expect(arrowSides(box(400, 0), box(0, 20))).toEqual(["left", "right"]);
  });
});

describe("edge routes", () => {
  test("a box below links bottom to top in a straight line", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(0, 200)],
    ]);
    const route = routeLinks([arrow("a", "b")], boxes).get("a-b")!;
    expect(route.path).toBe("M 120 68 L 120 200");
    // The label sits next to the line, never on it.
    expect(route.labelBox.x > 120 || route.labelBox.x + route.labelBox.width < 120).toBe(true);
  });

  test("a box saved below and to the side bends once in the gap, without a zig-zag", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(200, 200)],
    ]);
    const points = pathPoints(routeLinks([arrow("a", "b")], boxes).get("a-b")!.path);
    expect(points[0]).toEqual({ x: 120, y: 68 });
    expect(points.at(-1)).toEqual({ x: 320, y: 200 });
    // Every corner sits in the gap between the two boxes.
    for (const { y } of points.slice(1, -1)) expect(y > 68 && y < 200).toBe(true);
  });

  test("two arrows between the same boxes take separate ends and labels that do not overlap", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(0, 240)],
    ]);
    const routes = routeLinks([arrow("a", "b", "Send"), arrow("b", "a", "Back")], boxes);
    const forward = routes.get("a-b")!;
    const back = routes.get("b-a")!;
    expect(pathPoints(forward.path)[0]!.x).not.toBe(pathPoints(back.path)[0]!.x);
    expect(boxesOverlap(forward.labelBox, back.labelBox)).toBe(false);
  });

  test("an arrow over a box in between goes around it", () => {
    const middle = box(0, 200);
    const boxes = new Map([
      ["a", box(0, 0)],
      ["m", middle],
      ["b", box(0, 400)],
    ]);
    const route = routeLinks([arrow("a", "b")], boxes).get("a-b")!;
    const points = pathPoints(route.path);
    expect(points.at(-1)!.y).toBe(400);
    expect(points.some(({ x }) => x < middle.x || x > middle.x + middle.width)).toBe(true);
  });

  test("a loop sits at the right of its box, with its label after it", () => {
    const boxes = new Map([["a", box(0, 100)]]);
    const loop = routeLinks(
      [{ id: "loop", kind: "loop", source: "a", target: "a", text: "Ping", labelled: true }],
      boxes,
    ).get("loop")!;
    expect(loop.labelBox.x).toBeGreaterThan(240);
    expect(loop.label.y).toBe(134);
  });

  test("entries sit at the left of their box, with labels that stack apart", () => {
    const boxes = new Map([["a", box(400, 100)]]);
    const entry = (id: string): RoutedLink => ({
      id,
      kind: "entry",
      source: "a",
      target: "a",
      text: `${id} · from 5 states`,
      labelled: true,
    });
    const routes = routeLinks([entry("one"), entry("two")], boxes);
    const [one, two] = [routes.get("one")!, routes.get("two")!];
    for (const route of [one, two]) {
      expect(route.labelBox.x + route.labelBox.width).toBeLessThan(400);
      expect(route.path.endsWith(" 400 " + route.path.split(" ").at(-1))).toBe(true);
    }
    expect(boxesOverlap(one.labelBox, two.labelBox)).toBe(false);
  });

  test("an arrow takes the gaps of a tight column of boxes, and never crosses a box", () => {
    // Four entries stack labels above and below the middle box, past its edges.
    const boxes = new Map([
      ["a", box(400, 0)],
      ["m", box(400, 116)],
      ["n", box(400, 232)],
      ["b", box(400, 348)],
    ]);
    const entries = ["one", "two", "three", "four"].map((id): RoutedLink => ({
      id,
      kind: "entry",
      source: "m",
      target: "m",
      text: `${id} · from 4 states`,
      labelled: true,
    }));
    const points = pathPoints(routeLinks([arrow("b", "a"), ...entries], boxes).get("b-a")!.path);
    const crosses = (inner: Box) =>
      points.slice(1).some((to, index) => {
        const from = points[index]!;
        const segment = {
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          width: Math.abs(to.x - from.x),
          height: Math.abs(to.y - from.y),
        };
        return boxesOverlap(segment, inner);
      });
    expect(crosses(boxes.get("m")!)).toBe(false);
    expect(crosses(boxes.get("n")!)).toBe(false);
  });

  test("an arrow keeps clear of the entries of its neighbour box", () => {
    const boxes = new Map([
      ["a", box(400, 0)],
      ["b", box(400, 400)],
      ["c", box(400, 200)],
    ]);
    const routes = routeLinks(
      [
        arrow("a", "b"),
        {
          id: "in",
          kind: "entry",
          source: "c",
          target: "c",
          text: "In · from 4 states",
          labelled: true,
        },
      ],
      boxes,
    );
    const entryLabel = routes.get("in")!.labelBox;
    const points = pathPoints(routes.get("a-b")!.path);
    const crosses = points.some(
      ({ x, y }) =>
        x >= entryLabel.x &&
        x <= entryLabel.x + entryLabel.width &&
        y >= entryLabel.y &&
        y <= entryLabel.y + entryLabel.height,
    );
    expect(crosses).toBe(false);
  });
});
