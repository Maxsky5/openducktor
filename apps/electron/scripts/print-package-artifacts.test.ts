import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const artifactHook = require("./print-package-artifacts.cjs") as {
  selectPackageArtifacts: (buildResult: { artifactPaths?: string[]; outDir?: string }) => string[];
  formatPackageArtifacts: (artifactPaths: string[]) => string;
};

const tempDirs: string[] = [];

function makeTempReleaseDir(): string {
  const releaseDir = path.join(os.tmpdir(), `openducktor-electron-release-${crypto.randomUUID()}`);
  tempDirs.push(releaseDir);
  mkdirSync(path.join(releaseDir, "mac-arm64", "OpenDucktor.app"), { recursive: true });
  mkdirSync(
    path.join(
      releaseDir,
      "mac-arm64",
      "OpenDucktor.app",
      "Contents",
      "Frameworks",
      "Electron Helper.app",
    ),
    { recursive: true },
  );
  return releaseDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("print package artifacts hook", () => {
  test("selects generated installer files and app bundle from builder output", () => {
    const releaseDir = makeTempReleaseDir();
    const appBundle = path.join(releaseDir, "mac-arm64", "OpenDucktor.app");
    const dmg = path.join(releaseDir, "OpenDucktor-0.3.1-arm64.dmg");

    expect(
      artifactHook.selectPackageArtifacts({
        artifactPaths: [
          `${dmg}.blockmap`,
          dmg,
          path.join(releaseDir, "OpenDucktor-0.3.1-arm64-mac.zip"),
          path.join(releaseDir, "builder-debug.yml"),
        ],
        outDir: releaseDir,
      }),
    ).toEqual([dmg, appBundle].sort((left, right) => left.localeCompare(right)));
  });

  test("formats absolute artifact paths for terminal output", () => {
    expect(artifactHook.formatPackageArtifacts(["/tmp/OpenDucktor.dmg"])).toBe(
      "\nGenerated package artifacts:\n  /tmp/OpenDucktor.dmg",
    );
  });
});
