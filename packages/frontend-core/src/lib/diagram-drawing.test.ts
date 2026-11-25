import { describe, expect, test } from "bun:test";
import { prepareDiagram } from "./diagram-drawing";

const node = (kind: string, id: string, inner: string): string =>
  `<g class="pele-node pele-${kind}" data-id="${id}" transform="translate(0,0)">` +
  `<rect x="-50" y="-40" width="100" height="80" fill="var(--_s)" stroke="var(--_b)" style="rx:var(--_r)"/>` +
  `${inner}</g>`;

const bands = (svg: string): string[] =>
  [...prepareDiagram(svg).matchAll(/<path class="pele-node-header" d="([^"]+)"\/>/g)].map(
    (match) => match[1] ?? "",
  );

describe("prepareDiagram", () => {
  test("gives a class box a band from its top corners down to its first divider", () => {
    const svg = node(
      "class",
      "Task",
      '<path class="pele-divider" d="M-50,-12H50M-50,10H50" fill="none"/>',
    );

    expect(bands(svg)).toEqual(["M-50,-12V-30A10,10 0 0 1 -40,-40H40A10,10 0 0 1 50,-30V-12Z"]);
  });

  test.each([
    ["no attributes", "M-50,-12H50M-50,-2H50", -5],
    ["no methods", "M-50,-12H50M-50,30H50", 5],
  ])(
    "drops the divider of an empty member box in a class with %s and centers the members",
    (_case, path, shift) => {
      const svg = node(
        "class",
        "Status",
        `<path class="pele-divider" d="${path}" fill="none"/><g class="pele-members" font-size="12"></g>`,
      );

      const result = prepareDiagram(svg);

      expect(result).toContain('<path class="pele-divider" d="M-50,-12H50" fill="none"/>');
      expect(result).toContain(
        `<g class="pele-members" transform="translate(0,${shift})" font-size="12">`,
      );
    },
  );

  test("keeps both dividers of a class with attributes and methods", () => {
    const svg = node("class", "Task", '<path class="pele-divider" d="M-50,-12H50M-50,10H50"/>');

    expect(prepareDiagram(svg)).toContain('<path class="pele-divider" d="M-50,-12H50M-50,10H50"/>');
  });

  test("ends the band of an entity at its divider after the row stripes", () => {
    const svg = node(
      "entity",
      "TASK",
      '<g class="pele-er-stripes"><rect x="-50" width="100" y="-5" height="20"/></g>' +
        '<path class="pele-er-divider" d="M-50,-5H50"/>',
    );

    expect(bands(svg)).toEqual(["M-50,-5V-30A10,10 0 0 1 -40,-40H40A10,10 0 0 1 50,-30V-5Z"]);
  });

  test("adds no band to a box without members, also when a later box has a divider", () => {
    const svg =
      node("class", "Empty", '<text class="pele-label">Empty</text>') +
      node("class", "Full", '<path class="pele-divider" d="M-50,0H50"/>');

    const result = prepareDiagram(svg);

    expect(bands(svg)).toHaveLength(1);
    expect(result.indexOf("pele-node-header")).toBeGreaterThan(result.indexOf('data-id="Full"'));
  });

  test("moves the author fills of a sequence into a variable and keeps their other styles", () => {
    const svg =
      '<svg class="pele pele-sequence" style="max-width:100%;--_bg:var(--pele-bg,#fff)">' +
      '<rect class="pele-rect" style="rx:var(--_r);fill:rgb(191, 223, 255);"/>' +
      '<rect style="fill:rgba(255, 200, 120, 0.3)"/></svg>';

    expect(prepareDiagram(svg)).toBe(
      '<svg class="pele pele-sequence" style="max-width:100%;--_bg:var(--pele-bg,#fff)">' +
        '<rect class="pele-rect" style="rx:var(--_r);--author-fill:rgb(191, 223, 255);"/>' +
        '<rect style="--author-fill:rgba(255, 200, 120, 0.3)"/></svg>',
    );
  });

  test("keeps the author fills of other diagrams", () => {
    const svg =
      '<svg class="pele pele-flowchart"><g class="pele-node" style="fill:#9f6;stroke:#333"></g></svg>';

    expect(prepareDiagram(svg)).toBe(svg);
  });

  test("leaves other diagram nodes unchanged", () => {
    const svg = node("shape-rect", "Step", '<path class="pele-divider" d="M-50,0H50"/>');

    expect(prepareDiagram(svg)).toBe(svg);
  });
});
