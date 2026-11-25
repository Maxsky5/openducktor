import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scripts } from "../package.json";

test("runs workspace tests and reports failure after root script tests fail", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "openducktor-test-command-"));
  try {
    const workspace = path.join(directory, "suite");
    await mkdir(workspace);
    await Bun.write(
      path.join(directory, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["suite"],
        scripts: { test: scripts.test, "test:scripts": "exit 1" },
      }),
    );
    await Bun.write(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "test-suite", scripts: { test: "echo Workspace tests ran." } }),
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "test"],
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 2_000,
    });

    expect(result.exitCode, result.stderr.toString()).toBe(1);
    expect(result.stdout.toString()).toContain("Workspace tests ran.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
