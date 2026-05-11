import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const artifactHook = require("./print-package-artifacts.cjs") as {
  selectPackageArtifacts: (artifactPaths: string[]) => string[];
  formatPackageArtifacts: (artifactPaths: string[]) => string;
};

describe("print package artifacts hook", () => {
  test("selects generated installer files from builder artifacts", () => {
    expect(
      artifactHook.selectPackageArtifacts([
        "/tmp/OpenDucktor-0.3.1-arm64.dmg.blockmap",
        "/tmp/OpenDucktor-0.3.1-arm64.dmg",
        "/tmp/OpenDucktor-0.3.1-arm64-mac.zip",
        "/tmp/builder-debug.yml",
      ]),
    ).toEqual(["/tmp/OpenDucktor-0.3.1-arm64-mac.zip", "/tmp/OpenDucktor-0.3.1-arm64.dmg"]);
  });

  test("formats absolute artifact paths for terminal output", () => {
    expect(artifactHook.formatPackageArtifacts(["/tmp/OpenDucktor.dmg"])).toBe(
      "\nGenerated package artifacts:\n  /tmp/OpenDucktor.dmg",
    );
  });
});
