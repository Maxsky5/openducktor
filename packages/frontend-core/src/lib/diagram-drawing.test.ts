import { describe, expect, test } from "bun:test";
import { render } from "pele";
import { DIAGRAM_RENDER_OPTIONS, prepareDiagram } from "./diagram-drawing";

const draw = (source: string): string => prepareDiagram(render(source, DIAGRAM_RENDER_OPTIONS).svg);

/** The markup of one node, from its start to the start of the next node. */
const nodeOf = (svg: string, id: string): string => {
  const start = svg.indexOf(`data-id="${id}"`);
  const end = svg.indexOf('<g class="pele-node', start);
  return svg.slice(start, end === -1 ? undefined : end);
};

const dividerOf = (node: string): string =>
  /class="pele-divider" d="([^"]+)"/.exec(node)?.[1] ?? "";

describe("prepareDiagram", () => {
  test("gives each class and entity box with members a name band down to its first divider", () => {
    const svg =
      draw(
        "classDiagram\n  class Task {\n    +string id\n    +start() void\n  }\n  class Runtime",
      ) + draw("erDiagram\n  TASK {\n    string id\n  }\n  TASK ||--o{ SESSION : runs");

    const task = nodeOf(svg, "Task");
    const firstDivider = /M-?[\d.]+,(-?[\d.]+)H/.exec(dividerOf(task))?.[1];
    expect(task).toContain(`class="pele-node-header" d="M`);
    expect(task).toContain(`V${firstDivider}Z"`);
    expect(nodeOf(svg, "TASK")).toContain("pele-node-header");
    expect(nodeOf(svg, "Runtime")).not.toContain("pele-node-header");
    expect(nodeOf(svg, "SESSION")).not.toContain("pele-node-header");
  });

  test.each([
    ["only methods", "Store", "class Store {\n    +find(id) Task\n  }", "-"],
    [
      "only attributes",
      "Status",
      "class Status {\n    <<enumeration>>\n    OPEN\n    DONE\n  }",
      "",
    ],
  ])(
    "drops the empty member box of a class with %s and centers its members",
    (_case, id, body, shiftSign) => {
      const node = nodeOf(draw(`classDiagram\n  ${body}`), id);

      expect(dividerOf(node)).toMatch(/^M-?[\d.]+,-?[\d.]+H[\d.]+$/);
      expect(node).toMatch(
        new RegExp(`class="pele-members" transform="translate\\(0,${shiftSign}\\d`),
      );
    },
  );

  test("keeps both member boxes of a class with attributes and methods", () => {
    const node = nodeOf(
      draw("classDiagram\n  class Task {\n    +string id\n    +start() void\n  }"),
      "Task",
    );

    expect(dividerOf(node).match(/M/g)).toHaveLength(2);
    expect(node).not.toContain("translate(0,");
  });

  test("gives each sequence participant one hue and moves author fills into a variable", () => {
    const svg = draw(
      "sequenceDiagram\n  participant U\n  participant H\n  rect rgb(191, 223, 255)\n    U->>+H: Ask\n    H-->>-U: Answer\n  end",
    );

    expect(svg).toContain('pele-actor-participant pele-hue-fuchsia" data-id="U"');
    expect(svg).toContain('pele-actor-participant pele-hue-emerald" data-id="H"');
    expect(svg).toContain('class="pele-lifeline pele-hue-emerald" data-id="H"');
    expect(svg).toContain('class="pele-activation pele-hue-emerald" data-id="H"');
    expect(svg).toContain("--author-fill:rgb(191, 223, 255)");
    expect(svg).not.toMatch(/style="(?:[^"]*;)?fill:/);
  });

  test("draws no link for a Mermaid click line, so a diagram cannot leave the app", () => {
    const svg = draw('flowchart LR\n  A --> B\n  click A href "https://example.com"');

    expect(svg).toContain('data-id="A"');
    expect(svg).not.toContain("<a ");
  });

  test("leaves a flowchart unchanged", () => {
    const svg = render("flowchart LR\n  A[Start] --> B{Valid?}", DIAGRAM_RENDER_OPTIONS).svg;

    expect(prepareDiagram(svg)).toBe(svg);
  });
});
