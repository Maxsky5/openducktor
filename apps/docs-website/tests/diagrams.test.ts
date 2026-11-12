import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Position } from "@xyflow/react";
import { Box } from "lucide-react";
import { DIAGRAMS } from "../components/diagrams/catalog";
import { chainDiagram } from "../components/diagrams/chain";
import { defineDiagram } from "../components/diagrams/define";
import {
  type FlowLayout,
  ITEM_TONES,
  type NodeSpec,
  ZONE_TONES,
} from "../components/diagrams/spec";

const LAYOUTS = ["wide", "narrow"] as const;

// Loading every diagram defines it, so a diagram that `defineDiagram` refuses fails here.
const diagrams = await Promise.all(
  Object.entries(DIAGRAMS).map(async ([name, load]) => [name, await load()] as const),
);

/** The edges whose source or target handle is missing on its node. React Flow drops them. */
function loseEdges({ nodes, edges }: FlowLayout): string[] {
  const handles = new Set(
    nodes.flatMap((node) => (node.handles ?? []).map((h) => `${node.id}/${h.type}/${h.id}`)),
  );
  return edges
    .filter(
      (edge) =>
        !handles.has(`${edge.source}/source/${edge.sourceHandle}`) ||
        !handles.has(`${edge.target}/target/${edge.targetHandle}`),
    )
    .map((edge) => edge.id);
}

describe.each(diagrams)("the %s diagram", (_, diagram) => {
  test.each(LAYOUTS)("draws every edge of its %s layout between handles", (which) => {
    expect(loseEdges(diagram[which])).toEqual([]);
  });

  test.each(LAYOUTS)("keeps only the handles that the edges of its %s layout use", (which) => {
    const { nodes, edges } = diagram[which];
    const used = new Set(
      edges.flatMap((edge) => [
        `${edge.source}/${edge.sourceHandle}`,
        `${edge.target}/${edge.targetHandle}`,
      ]),
    );
    const unused = nodes.flatMap((node) =>
      (node.handles ?? []).map((h) => `${node.id}/${h.id}`).filter((id) => !used.has(id)),
    );
    expect(unused).toEqual([]);
  });
});

const item = (title: string): NodeSpec => ({ type: "item", data: { title, Icon: Box } });
const box = (x: number, y = 0) => ({ x, y, w: 100, h: 40 });

/** A diagram of two items side by side, with the given edge and boxes in both layouts. */
const pair = (edge: readonly [`${"a" | "b"}.${string}`, `${"a" | "b"}.${string}`], width = 300) => {
  const layout = {
    width,
    height: 40,
    boxes: { a: box(0), b: box(200) },
    ports: {
      b: [
        { id: "in", side: "left" as const, at: 10 },
        { id: "spare", side: "top" as const, at: 5 },
      ],
    },
    edges: [edge],
  };
  return defineDiagram({
    name: "pair",
    label: "A pair.",
    nodes: { a: item("A"), b: item("B") },
    wide: layout,
    narrow: layout,
  });
};

describe("defineDiagram", () => {
  test("refuses an edge to a port that the node does not have", () => {
    expect(() => pair(["a.r", "b.missing"])).toThrow(
      'The wide layout of the diagram "pair" has no port "missing" on the node "b".',
    );
  });

  test("refuses a node outside the canvas", () => {
    expect(() => pair(["a.r", "b.l"], 250)).toThrow(
      'The wide layout of the diagram "pair" puts the node "b" outside the canvas (250x40).',
    );
  });

  test("refuses an edge to a node that the layout leaves out", () => {
    expect(() =>
      defineDiagram({
        name: "gap",
        label: "A gap.",
        nodes: { a: item("A"), b: item("B") },
        wide: { width: 300, height: 40, boxes: { a: box(0), b: box(200) }, edges: [] },
        narrow: { width: 300, height: 40, boxes: { a: box(0), b: null }, edges: [["a.r", "b.l"]] },
      }),
    ).toThrow(
      'The narrow layout of the diagram "gap" has an edge to the node "b", which is not in this layout.',
    );
  });

  test("refuses a node outside its parent, with the parent offset", () => {
    const zone: NodeSpec = { type: "zone", data: { title: "Zone", Icon: Box } };
    const layout = {
      width: 400,
      height: 200,
      boxes: {
        zone: { x: 100, y: 0, w: 200, h: 100 },
        a: { x: 150, y: 10, w: 100, h: 40, in: "zone" },
      },
      edges: [],
    };
    expect(() =>
      defineDiagram({
        name: "nest",
        label: "A nest.",
        nodes: { zone, a: item("A") },
        wide: layout,
        narrow: layout,
      }),
    ).toThrow(
      'The wide layout of the diagram "nest" puts the node "a" outside the node "zone" (200x100).',
    );
  });

  test("refuses a tone without a style", () => {
    // A tone outside the types, as JSON or a stale spec can give it.
    const zone: NodeSpec = JSON.parse(
      '{ "type": "zone", "data": { "title": "Zone", "tone": "computer" } }',
    );
    const layout = { width: 100, height: 40, boxes: { zone: box(0) }, edges: [] };
    expect(() =>
      defineDiagram({
        name: "tone",
        label: "A tone.",
        nodes: { zone },
        wide: layout,
        narrow: layout,
      }),
    ).toThrow(`gives the node "zone" the tone "computer". Use one of: ${ZONE_TONES.join(", ")}.`);
  });

  test("places an aligned port in line with the middle of the facing node", () => {
    const diagram = defineDiagram({
      name: "aligned",
      label: "Aligned.",
      nodes: { a: item("A"), b: item("B") },
      wide: {
        width: 300,
        height: 200,
        boxes: { a: { x: 0, y: 120, w: 100, h: 40 }, b: { x: 200, y: 20, w: 100, h: 160 } },
        edges: [["a.r", "b.l", { align: "source" }]],
      },
      narrow: { width: 300, height: 200, boxes: { a: box(0), b: box(200) }, edges: [] },
    });
    const target = diagram.wide.nodes.find((node) => node.id === "b");
    // The middle of a is at y 140, which is 120 under the top of b. The 1px handle is centered.
    expect(target?.handles).toEqual([
      {
        id: "l-a-target",
        type: "target",
        position: Position.Left,
        x: -0.5,
        y: 119.5,
        width: 1,
        height: 1,
      },
    ]);
  });

  test("gives a node only the handles that its edges use", () => {
    const target = pair(["a.r", "b.in"]).wide.nodes.find((node) => node.id === "b");
    expect(target?.handles?.map((h) => h.id)).toEqual(["in-target"]);
  });
});

describe("chainDiagram", () => {
  const chain = chainDiagram({
    name: "chain",
    label: "A chain.",
    steps: [
      { id: "one", title: "One", Icon: Box },
      { id: "two", title: "Two", Icon: Box, narrowHeight: 90 },
      { id: "three", title: "Three", Icon: Box },
    ],
    heights: { wide: 80, narrow: 60 },
    edge: { label: "Then" },
    loop: { from: "three", to: "one", label: "Again" },
  });

  test("puts the steps in a row with an arrow to the next one, and the loop under the row", () => {
    expect(chain.wide.nodes.map((node) => node.position)).toEqual([
      { x: 1, y: 1 },
      { x: 311, y: 1 },
      { x: 621, y: 1 },
    ]);
    expect(chain.wide.edges.map((edge) => edge.id)).toEqual([
      "one.r-two.l",
      "two.r-three.l",
      "three.b-one.b",
    ]);
    expect(chain.wide.height).toBe(80 + 2 + 44);
  });

  test("puts the label of the loop on its outer part, along the line", () => {
    // Under the row: the bottom of the boxes is at y 81, and the line turns 30px under it.
    expect(chain.wide.labels.at(-1)).toEqual({
      id: "three.b-one.b",
      text: "Again",
      x: (1 + 238 / 2 + 621 + 238 / 2) / 2,
      y: 81 + 30,
      vertical: false,
    });
    // Left of the column: the boxes start at x 40, and the line turns 24px left of them.
    expect(chain.narrow.labels.at(-1)).toMatchObject({
      x: 40 - 24,
      y: (31 + 269) / 2,
      vertical: true,
    });
  });

  test("puts the steps in a column with their own heights, and the loop on the left", () => {
    expect(chain.narrow.nodes.map((node) => [node.position, node.height])).toEqual([
      [{ x: 40, y: 1 }, 60],
      [{ x: 40, y: 105 }, 90],
      [{ x: 40, y: 239 }, 60],
    ]);
    expect(chain.narrow.edges.at(-1)?.id).toBe("three.l-one.l");
    expect(chain.narrow.height).toBe(300);
  });
});

test("every tone of a node type has a style", () => {
  const css = readFileSync(new URL("../components/diagrams/nodes.css", import.meta.url), "utf8");
  const missing = [
    ...ITEM_TONES.map((tone) => `.docs-flow-item[data-tone="${tone}"]`),
    ...ZONE_TONES.map((tone) => `.docs-flow-zone[data-tone="${tone}"]`),
  ].filter((selector) => !css.includes(selector));
  expect(missing).toEqual([]);
});
