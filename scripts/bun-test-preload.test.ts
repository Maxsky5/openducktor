import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { workspacePackageJsonPaths } from "./workspace-packages";

const packageManifestSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const ROOT = path.resolve(import.meta.dir, "..");
const PRELOAD_PATH = "../../tools/bun-test-preload.ts";

const runFixtures = async (
  cwd: string,
  command: string[],
  files: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const fixtureDir = await mkdtemp(path.join(cwd, ".test-isolation-"));
  try {
    const paths = await Promise.all(
      files.map(async (content, index) => {
        const filePath = path.join(fixtureDir, `${index}.test.tsx`);
        await writeFile(filePath, content);
        return filePath;
      }),
    );
    const child = Bun.spawn({
      cmd: [process.execPath, ...command, ...paths],
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
};

describe("Bun test preload", () => {
  test("loads the shared config guard from each workspace Bun test command", () => {
    const missingPreload = workspacePackageJsonPaths(ROOT).flatMap((relativePath) => {
      const packagePath = path.resolve(ROOT, relativePath);
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
      return [manifest.name ?? relativePath];
    });

    expect(missingPreload).toEqual([]);
  });

  test("restores the root test directories on repeat and removes them when done", async () => {
    const fixture = `import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
test("uses temporary directories without browser globals", () => {
  const configDir = process.env.OPENDUCKTOR_CONFIG_DIR;
  if (!configDir) throw new Error("The test config directory is missing.");
  const workerTmpDir = tmpdir();
  expect(workerTmpDir).toBe(process.env.TMPDIR);
  expect(statSync(configDir).isDirectory()).toBe(true);
  expect(globalThis.document).toBeUndefined();
  console.log("test config: " + configDir);
  console.log("worker tmp: " + workerTmpDir);
});
`;
    const { exitCode, stderr, stdout } = await runFixtures(
      ROOT,
      ["test", "--rerun-each=3"],
      [fixture, fixture],
    );
    expect(exitCode, stderr).toBe(0);
    expect(stdout.match(/test config:/g)).toHaveLength(6);
    const configDir = stdout.match(/test config: (.+)/)?.[1];
    const workerTmpDir = stdout.match(/worker tmp: (.+)/)?.[1];
    if (!configDir || !workerTmpDir) {
      throw new Error("Expected the fixture to print its test directories.");
    }
    await expect(access(configDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(workerTmpDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes mounted React content after every Bun repeat", async () => {
    const { exitCode, stderr, stdout } = await runFixtures(
      path.join(ROOT, "packages/frontend"),
      ["run", "test", "--rerun-each=3"],
      ["@testing-library/react", "@testing-library/react/pure"].map(
        (entry) => `import { expect, test } from "bun:test";
import { render, screen } from "${entry}";
import { createElement } from "react";
test("a repeat starts without the previous render", () => {
  expect(screen.queryAllByRole("button", { name: "Run check" }).length).toBe(0);
  render(createElement("button", null, "Run check"));
  expect(screen.getByRole("button", { name: "Run check" })).toBeDefined();
  console.log("REPEAT_CHECKED");
});
`,
      ),
    );
    expect(exitCode, stderr).toBe(0);
    expect(stdout.match(/REPEAT_CHECKED/g)).toHaveLength(6);
  });

  test("delivers zero-delay DOM timers before and after a file uses fake timers", async () => {
    const { exitCode, stderr } = await runFixtures(
      path.join(ROOT, "packages/frontend"),
      ["test", "--only-failures", "--timeout=1000"],
      [
        `import { beforeAll, expect, mock, test } from "bun:test";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
const scheduleInWindow = globalThis.setTimeout;
const realCallback = mock(() => {});
beforeAll(() => { scheduleInWindow(realCallback, 0); });
setupTestingLibraryFakeTimers();
test("the real callback runs and a fake callback is still due when the file ends", () => {
  expect(realCallback).toHaveBeenCalled();
  const callback = mock(() => {});
  scheduleInWindow(callback, 0);
  expect(callback).not.toHaveBeenCalled();
});
`,
        `import { expect, test } from "bun:test";
test("the next callback runs on the real clock", async () => {
  const outcome = await new Promise(resolve => setTimeout(() => resolve("ran"), 0));
  expect(outcome).toBe("ran");
});
`,
      ],
    );
    expect(exitCode, stderr).toBe(0);
  });

  test("clears frontend DOM state between files and stops on a timeout", async () => {
    const { exitCode, stderr, stdout } = await runFixtures(
      path.join(ROOT, "packages/frontend"),
      ["run", "test"],
      [
        `import { expect, test } from "bun:test";
import { toast } from "sonner";
test("leaves unmanaged DOM", () => {
  document.body.textContent = "left by the previous file";
  sessionStorage.setItem("isolated", "first test");
  toast("Saved by the previous test");
  expect(toast.getToasts().map(item => item.title)).toEqual(["Saved by the previous test"]);
  console.log("DIRTY_DOM_SET");
});
test("clears storage and notifications without Testing Library", () => {
  expect(sessionStorage.getItem("isolated")).toBeNull();
  expect(toast.getToasts()).toEqual([]);
});
`,
        `import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createElement, useEffect } from "react";
let unmounted = false;
function WritesOnUnmount() {
  useEffect(() => () => {
    unmounted = true;
    localStorage.setItem("isolated", "unmount");
  }, []);
  return createElement("button", null, "Mounted by the first test");
}
test("starts with an empty DOM", () => {
  expect(document.body.textContent).toBe("");
  expect(document.doctype?.name).toBe("html");
  expect(document.compatMode).toBe("CSS1Compat");
  render(createElement(WritesOnUnmount));
  expect(screen.getByRole("button", { name: "Mounted by the first test" })).toBeDefined();
  console.log("FRESH_DOM_CHECKED");
});
test("unmounts before clearing storage", () => {
  expect(unmounted).toBe(true);
  expect(screen.queryByRole("button", { name: "Mounted by the first test" })).toBeNull();
  expect(localStorage.getItem("isolated")).toBeNull();
});
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
      ],
    );
    expect(exitCode, stdout + stderr).toBe(1);
    expect(stdout, stderr).toMatch(/^DIRTY_DOM_SET\r?\nFRESH_DOM_CHECKED\r?$/m);
    expect(stderr).toContain("this test timed out after 20ms");
    expect(stdout).not.toContain("CASCADE_SAME_FILE");
    expect(stdout).not.toContain("CASCADE_LATER_FILE");
  });
});
