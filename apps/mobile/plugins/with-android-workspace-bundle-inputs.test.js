const { describe, expect, test } = require("bun:test");
const { readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");
const { WORKSPACE_PACKAGES_DIR } = require("./with-android-workspace-bundle-inputs.js");

const APP_ROOT = realpathSync(path.join(__dirname, ".."));
const TRACKED_DIR = path.resolve(APP_ROOT, "android", WORKSPACE_PACKAGES_DIR);

/** The workspace packages that the app bundles: its workspace dependencies and theirs. */
const bundledWorkspaceDirs = () => {
  const found = new Set();
  const pending = [APP_ROOT];
  while (pending.length > 0) {
    const dir = pending.pop();
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (!version.startsWith("workspace:")) continue;
      const dependencyDir = realpathSync(path.join(dir, "node_modules", name));
      if (found.has(dependencyDir)) continue;
      found.add(dependencyDir);
      pending.push(dependencyDir);
    }
  }
  return [...found];
};

describe("with-android-workspace-bundle-inputs", () => {
  test("tracks the folder of every workspace package that the release bundle includes", () => {
    const bundled = bundledWorkspaceDirs();

    expect(bundled).toContain(path.join(TRACKED_DIR, "frontend-core"));
    for (const dir of bundled) {
      expect(path.dirname(dir)).toBe(TRACKED_DIR);
    }
  });
});
