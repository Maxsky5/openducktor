import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const packageManifestSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const ROOT = path.resolve(import.meta.dir, "..");
const PRELOAD_PATH = "../../tools/bun-test-preload.ts";

const workspacePackagePaths = (): string[] =>
  ["apps", "packages", "tools/oxlint"]
    .flatMap((directory) =>
      readdirSync(path.join(ROOT, directory), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(ROOT, directory, entry.name, "package.json")),
    )
    .filter(existsSync);

const runFrontendFixtures = async (
  files: string[],
): Promise<{ exitCode: number; output: string }> => {
  const frontendRoot = path.join(ROOT, "packages/frontend");
  const fixtureDir = await mkdtemp(path.join(frontendRoot, ".test-isolation-"));
  try {
    const paths = await Promise.all(
      files.map(async (content, index) => {
        const filePath = path.join(fixtureDir, `${index}.test.tsx`);
        await writeFile(filePath, content);
        return filePath;
      }),
    );
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "test", ...paths],
      cwd: frontendRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    return { exitCode, output: stdout + stderr };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
};

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
        path.join(ROOT, "tools/bun-test-preload.ts"),
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
        path.join(ROOT, "packages/frontend/src/pages/agents/use-navigation-url-sync.test.tsx"),
      ],
      cwd: ROOT,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode, stderr).toBe(0);
  });

  test("gives a later frontend file a fresh DOM after a successful file leaves unmanaged nodes", async () => {
    const { exitCode, output } = await runFrontendFixtures([
      `import { test } from "bun:test";
test("leaves unmanaged DOM", () => {
  document.body.textContent = "left by the previous file";
});
`,
      `import { expect, test } from "bun:test";
test("starts with an empty DOM", () => {
  expect(document.body.textContent).toBe("");
  console.log("FRESH_DOM_CHECKED");
});
`,
    ]);
    expect(exitCode, output).toBe(0);
    expect(output).toContain("FRESH_DOM_CHECKED");
  });

  test("stops the frontend suite after a timeout before shared DOM state can affect later tests", async () => {
    const { exitCode, output } = await runFrontendFixtures([
      `import { test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement } from "react";
test("intentional timeout", async () => {
  render(createElement("button", null, "mounted before timeout"));
  await Bun.sleep(100);
  render(createElement("button", null, "mounted after timeout"));
}, 20);
test("same file after timeout", () => {
  console.log("CASCADE_SAME_FILE");
});
`,
      `import { test } from "bun:test";
test("later file after timeout", () => {
  console.log("CASCADE_LATER_FILE");
});
`,
    ]);
    expect(exitCode, output).toBe(1);
    expect(output).toContain("this test timed out after 20ms");
    expect(output).not.toContain("CASCADE_SAME_FILE");
    expect(output).not.toContain("CASCADE_LATER_FILE");
  });
});
