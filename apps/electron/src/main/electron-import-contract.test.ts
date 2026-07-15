import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

describe("Electron runtime imports", () => {
  test("do not use runtime named imports from electron", () => {
    const runtimeEntryPoints = [
      "apps/electron/src/main/main.ts",
      "apps/electron/src/main/main-menu.ts",
      "apps/electron/src/preload/preload.ts",
    ];

    for (const entryPoint of runtimeEntryPoints) {
      expect(readRepoFile(entryPoint)).not.toMatch(/import\s+\{[^}]+\}\s+from\s+"electron"/u);
    }
  });

  test("do not import build scripts from production sources", () => {
    const productionSources = [
      ...new Bun.Glob("apps/electron/src/**/*.{ts,tsx}").scanSync({ cwd: REPO_ROOT }),
    ].filter((path) => !/\.(?:conformance|spec|test)\.[^.]+$/u.test(path));

    for (const sourcePath of productionSources) {
      expect(readRepoFile(sourcePath)).not.toMatch(
        /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*\/scripts\//u,
      );
    }
  });
});
