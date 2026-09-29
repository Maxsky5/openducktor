import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIRECTORIES = ["src", "scripts", "config", "tests", "browser-tests"];
const EXTENSIONS = [".astro", ".css", ".ts", ".mjs"];
/** A longer file mixes more than one job, so it gets split. */
const MAX_LINES = 400;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

test(`every source file of the site has ${MAX_LINES} lines or fewer`, () => {
  const long = DIRECTORIES.flatMap((directory) => sourceFiles(join(ROOT, directory)))
    .map((path) => ({ path, lines: readFileSync(path, "utf8").trimEnd().split("\n").length }))
    .filter(({ lines }) => lines > MAX_LINES)
    .map(({ path, lines }) => `${relative(ROOT, path)}: ${lines} lines. Split the file.`);
  expect(long).toEqual([]);
});
