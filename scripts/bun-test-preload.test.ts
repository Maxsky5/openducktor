import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const packageManifestSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const ROOT = path.resolve(import.meta.dir, "..");
const PRELOAD_PATH = "../../scripts/bun-test-preload.ts";

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
      if (!testCommand?.startsWith("bun test")) {
        return [];
      }
      const bunfigPath = path.join(path.dirname(packagePath), "bunfig.toml");
      const commandLoadsPreload = testCommand.includes(`--preload ${PRELOAD_PATH}`);
      const bunfigLoadsPreload =
        existsSync(bunfigPath) &&
        readFileSync(bunfigPath, "utf8").includes(`preload = ["${PRELOAD_PATH}"]`);
      if (commandLoadsPreload || bunfigLoadsPreload) {
        return [];
      }
      return [manifest.name ?? path.relative(ROOT, packagePath)];
    });

    expect(missingPreload).toEqual([]);
  });

  test("removes the test config directory after the suite", async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "test",
        "--preload",
        path.join(ROOT, "scripts/bun-test-preload.ts"),
        path.join(ROOT, "scripts/test-support/bun-test-preload-fixture.test.ts"),
      ],
      cwd: ROOT,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    const configDir = stdout.match(/test config: (.+)/)?.[1];
    const workerTmpDir = stdout.match(/worker tmp: (.+)/)?.[1];
    if (!configDir || !workerTmpDir) {
      throw new Error("Expected the fixture to print its test directories.");
    }
    await expect(access(configDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(workerTmpDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("loads the frontend DOM setup for a focused test run from the repository root", async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "test",
        path.join(ROOT, "packages/frontend/src/lib/canonical-route-redirect.test.tsx"),
      ],
      cwd: ROOT,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode, stderr).toBe(0);
  });
});
