import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const packageManifestSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const ROOT = path.resolve(import.meta.dir, "..");
const PRELOAD = "--preload ../../scripts/bun-test-preload.ts";

const workspacePackagePaths = (): string[] =>
  ["apps", "packages", "tools/oxlint"]
    .flatMap((directory) =>
      readdirSync(path.join(ROOT, directory), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(ROOT, directory, entry.name, "package.json")),
    )
    .filter(existsSync);

describe("Bun test preload", () => {
  test("loads the shared config guard from each workspace Bun test command", () => {
    const missingPreload = workspacePackagePaths().flatMap((packagePath) => {
      const manifest = packageManifestSchema.parse(JSON.parse(readFileSync(packagePath, "utf8")));
      const testCommand = manifest.scripts?.test;
      if (!testCommand?.startsWith("bun test") || testCommand.includes(PRELOAD)) {
        return [];
      }
      return [manifest.name ?? path.relative(ROOT, packagePath)];
    });

    expect(missingPreload).toEqual([]);
  });
});
