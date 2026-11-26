import { describe, expect, test } from "bun:test";
import { readProduct } from "./test-support/product-source";

const theme = await readProduct("packages/theme/src/diagrams.css");
const markdown = await readProduct("packages/frontend/src/components/ui/markdown.css");
const replica = await Bun.file(
  new URL("./replicas/studio/FlowDiagram.css", import.meta.url),
).text();

/** The value of the property `name` in the first rule of `css` that declares it. */
function declared(css: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

/** The part of `css` from the rule `selector` to the end. */
function from(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`The stylesheet has no rule ${selector}.`);
  return css.slice(start);
}

/** A product value with the names of the replica: the app colors and the `--flow-` prefix. */
function renamed(value: string | undefined): string | undefined {
  return value
    ?.replaceAll("--pele-fg", "--foreground")
    .replaceAll("--pele-bg", "--flow-canvas")
    .replaceAll("--diagram-", "--flow-");
}

/** A product stylesheet, its dark rule, and its properties with the replica name of each. */
const COPIED = [
  {
    product: theme,
    dark: ":is(.dark .pele, .pele.dark)",
    names: {
      "--diagram-indigo": "--flow-hue",
      "--diagram-fill-mix": "--flow-fill-mix",
      "--diagram-text-mix": "--flow-text-mix",
      "--pele-line": "--flow-line",
    },
  },
  {
    product: markdown,
    dark: ".dark {",
    names: { "--diagram-canvas": "--flow-canvas", "--diagram-node-base": "--flow-node-base" },
  },
] as const;

const REPLICA_DARK = from(replica, ':where([data-theme="dark"]) & .flow');

describe("the flowchart copied from the diagram theme of the product", () => {
  test("the canvas, the hue, and the mixes match in the light and the dark theme", () => {
    for (const { product, dark, names } of COPIED) {
      for (const [name, copy] of Object.entries(names)) {
        const light = renamed(declared(product, name));
        expect(light).toBeDefined();
        expect(declared(replica, copy)).toBe(light);
        const darkValue = renamed(declared(from(product, dark), name)) ?? light;
        expect(declared(REPLICA_DARK, copy) ?? light).toBe(darkValue);
      }
    }
  });

  test("the steps take the border mix and the corner radius of the theme", () => {
    const borderMix = declared(theme, "--diagram-border-mix");
    expect(replica).toContain(
      `color-mix(in oklab, var(--flow-hue) ${borderMix}, var(--foreground))`,
    );
    expect(replica).toContain(`rx: ${declared(theme, "--pele-radius")};`);
  });
});
