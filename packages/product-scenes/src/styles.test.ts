import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const DIRECTORIES = ["src", "styles", "scripts"];
/**
 * A longer stylesheet mixes more than one job, so it gets split. The `max-lines` rule of oxlint
 * checks the code files.
 */
const MAX_LINES = 400;
/**
 * The stylesheets that do not scope their rules to the stage. The base files declare the layer
 * order and size the scene root, and the generated theme scopes its own selectors.
 */
const UNSCOPED = new Set(["styles/index.css", "styles/state.css", "styles/theme.css"]);

function files(extensions: string[]): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
    });
  return DIRECTORIES.flatMap((directory) => walk(join(PACKAGE, directory)));
}

/** The first capture group of each match of `pattern` in `text`. */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

describe("styles", () => {
  test("every custom property that a stylesheet reads has a definition in the package", () => {
    const defined = new Set<string>();
    for (const path of files([".css"])) {
      const css = readFileSync(path, "utf8");
      for (const name of captures(css, /(--[\w-]+)\s*:/g)) defined.add(name);
      for (const name of captures(css, /@property\s+(--[\w-]+)/g)) defined.add(name);
    }
    for (const path of files([".ts", ".tsx"])) {
      const code = readFileSync(path, "utf8");
      for (const name of captures(code, /["'`](--[\w-]+)["'`]/g)) defined.add(name);
    }
    const missing = files([".css"]).flatMap((path) =>
      captures(readFileSync(path, "utf8"), /var\(\s*(--[\w-]+)/g)
        .filter((name) => !defined.has(name))
        .map((name) => `${relative(PACKAGE, path)} reads ${name}, which nothing defines.`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  test("each stylesheet keeps its rules in one layer and scopes them to the stage", () => {
    const loose = files([".css"])
      .map((path) => relative(PACKAGE, path))
      .filter((path) => !UNSCOPED.has(path))
      .filter((path) => {
        const css = readFileSync(join(PACKAGE, path), "utf8");
        return !/^@layer (product|replica|views) \{\n {2}:where\(\.stage\) \{\n/.test(css);
      })
      .map((path) => `${path} must open with @layer <name> { :where(.stage) { ... } }.`);
    expect(loose).toEqual([]);
  });
});

test(`every stylesheet of the package has ${MAX_LINES} lines or fewer`, () => {
  const long = files([".css"])
    .map((path) => ({ path, lines: readFileSync(path, "utf8").trimEnd().split("\n").length }))
    .filter(({ lines }) => lines > MAX_LINES)
    .map(({ path, lines }) => `${relative(PACKAGE, path)}: ${lines} lines. Split the file.`);
  expect(long).toEqual([]);
});
