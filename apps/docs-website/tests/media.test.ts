import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCREENS, type Screen } from "../assets/media";
import { publishedPages } from "../lib/pages";

const app = join(import.meta.dir, "..");
const screens: Record<string, Screen> = SCREENS;

/** The id and the part keys of each `<AnnotatedScreenshot>` of the pages. */
function annotatedScreenshots(): { file: string; id: string; keys: string[] }[] {
  return publishedPages().flatMap(({ file }) => {
    const source = readFileSync(join(app, file), "utf8");
    return [...source.matchAll(/<AnnotatedScreenshot\s[\s\S]*?\/>/g)].map(([element]) => ({
      file,
      id: /\sid="([^"]+)"/.exec(element)?.[1] ?? "",
      keys: [...element.matchAll(/\bat:\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
    }));
  });
}

test("each part box stays inside its capture", () => {
  const outside = Object.entries(screens).flatMap(([id, screen]) =>
    Object.entries(screen.parts ?? {})
      .filter(
        ([, { x, y, w, h }]) => x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100 || y + h > 100,
      )
      .map(([key]) => `${id}.${key}`),
  );
  expect(outside).toEqual([]);
});

test("each annotated screenshot names parts that have a box, and each box has a page", () => {
  const used = annotatedScreenshots();
  expect(used.length).toBeGreaterThan(0);
  const missing = used.flatMap(({ file, id, keys }) =>
    keys.filter((key) => !screens[id]?.parts?.[key]).map((key) => `${file}: ${id}.${key}`),
  );
  expect(missing).toEqual([]);
  const named = new Set(used.flatMap(({ id, keys }) => keys.map((key) => `${id}.${key}`)));
  const unused = Object.entries(screens).flatMap(([id, screen]) =>
    Object.keys(screen.parts ?? {})
      .map((key) => `${id}.${key}`)
      .filter((part) => !named.has(part)),
  );
  expect(unused).toEqual([]);
});
