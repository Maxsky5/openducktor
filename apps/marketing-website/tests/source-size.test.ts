import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIRECTORIES = ["src", "scripts", "config", "tests", "browser-tests"];
const EXTENSIONS = [".astro", ".css", ".ts", ".mjs"];
/** A longer file mixes more than one job, so it gets split. */
const MAX_LINES = 400;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
      }),
    )
  ).flat();
}

test(`every source file of the site has ${MAX_LINES} lines or fewer`, async () => {
  const files = (
    await Promise.all(DIRECTORIES.map((directory) => sourceFiles(join(ROOT, directory))))
  ).flat();
  const counts = await Promise.all(
    files.map(async (path) => ({
      path,
      lines: (await readFile(path, "utf8")).trimEnd().split("\n").length,
    })),
  );
  const long = counts
    .filter(({ lines }) => lines > MAX_LINES)
    .map(({ path, lines }) => `${relative(ROOT, path)}: ${lines} lines. Split the file.`);
  expect(long).toEqual([]);
});
