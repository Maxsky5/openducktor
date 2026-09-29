import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { productTheme } from "../scripts/product-theme";

const SOURCE = fileURLToPath(new URL("../src", import.meta.url));
const THEME = fileURLToPath(new URL("../../../packages/frontend/src/styles.css", import.meta.url));

function files(directory: string, extensions: string[]): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

/** The first capture group of each match of `pattern` in `text`. */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/** The custom properties that a stylesheet declares, or that markup and scripts set by name. */
function definitions(): Set<string> {
  const names = new Set<string>();
  const sources = [
    productTheme(readFileSync(THEME, "utf8")),
    ...files(SOURCE, [".css"]).map((path) => readFileSync(path, "utf8")),
  ];
  for (const css of sources) {
    for (const name of captures(css, /(--[\w-]+)\s*:/g)) names.add(name);
    for (const name of captures(css, /@property\s+(--[\w-]+)/g)) names.add(name);
  }
  for (const path of files(SOURCE, [".astro", ".ts"])) {
    const code = readFileSync(path, "utf8");
    for (const name of captures(code, /["'`](--[\w-]+)["'`]/g)) names.add(name);
    for (const name of captures(code, /(--[\w-]+)\s*:/g)) names.add(name);
  }
  return names;
}

test("every custom property that a stylesheet reads has a definition", () => {
  const defined = definitions();
  const missing = files(SOURCE, [".css"]).flatMap((path) =>
    captures(readFileSync(path, "utf8"), /var\(\s*(--[\w-]+)/g)
      .filter((name) => !defined.has(name))
      .map((name) => `${relative(SOURCE, path)} reads ${name}, which nothing defines.`),
  );
  expect([...new Set(missing)]).toEqual([]);
});
