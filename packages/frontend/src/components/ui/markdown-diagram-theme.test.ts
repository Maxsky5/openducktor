import { describe, expect, test } from "bun:test";
import { prepareDiagram } from "@openducktor/frontend-core/lib/diagram-drawing";
import { render } from "pele";

const theme = await Bun.file(
  Bun.resolveSync("@openducktor/theme/diagrams.css", import.meta.dir),
).text();

describe("diagram theme", () => {
  test("rounds the name band of a class with the radius of the boxes", () => {
    const radius = /--pele-radius: (\d+)px;/.exec(theme)?.[1];
    const svg = prepareDiagram(
      render("classDiagram\n  class Task {\n    +string id\n    +start() void\n  }").svg,
    );

    expect(radius).toBeDefined();
    expect(svg).toMatch(new RegExp(`class="pele-node-header" d="[^"]*A${radius},${radius} `));
  });

  test("has a color for each sequence participant hue", () => {
    const participants = ["A", "B", "C", "D", "E", "F"];
    const svg = prepareDiagram(
      render(`sequenceDiagram\n${participants.map((id) => `  participant ${id}`).join("\n")}`).svg,
    );
    const hues = new Set(Array.from(svg.matchAll(/pele-hue-([a-z]+)/g), (match) => match[1]));

    expect(hues.size).toBe(participants.length);
    for (const hue of hues) expect(theme).toContain(`.pele-hue-${hue} {`);
  });
});
