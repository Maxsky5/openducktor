import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  collectReleaseArtifacts,
  detectHostReleaseArch,
  detectHostReleasePlatform,
  isReleaseArtifact,
  resolveElectronBuilderArgs,
  resolveElectronBuilderEnv,
} from "./package-build";

describe("build Electron release artifact", () => {
  it("maps host platform and architecture to Electron release targets", () => {
    expect(detectHostReleasePlatform("darwin")).toBe("macos");
    expect(detectHostReleasePlatform("linux")).toBe("linux");
    expect(detectHostReleasePlatform("win32")).toBe("windows");
    expect(detectHostReleasePlatform("freebsd")).toBeUndefined();
    expect(detectHostReleaseArch("arm64")).toBe("arm64");
    expect(detectHostReleaseArch("x64")).toBe("x64");
    expect(detectHostReleaseArch("ia32")).toBeUndefined();
  });

  it("builds signed macOS artifacts without disabling notarization", () => {
    expect(
      resolveElectronBuilderArgs({
        arch: "arm64",
        platform: "macos",
        signed: true,
        stageReleaseArtifacts: true,
      }),
    ).toEqual(["--config", "electron-builder.yml", "--mac", "--arm64", "--publish", "never"]);
  });

  it("builds unsigned Linux artifacts without macOS notarization overrides", () => {
    expect(
      resolveElectronBuilderArgs({
        arch: "x64",
        platform: "linux",
        signed: false,
        stageReleaseArtifacts: false,
      }),
    ).toEqual([
      "--config",
      "electron-builder.yml",
      "--linux",
      "AppImage",
      "--x64",
      "--publish",
      "never",
    ]);
  });

  it("builds local unsigned macOS packages without update metadata", () => {
    expect(
      resolveElectronBuilderArgs({
        arch: "x64",
        platform: "macos",
        signed: false,
        stageReleaseArtifacts: false,
      }),
    ).toEqual([
      "--config",
      "electron-builder.yml",
      "--mac",
      "dmg",
      "--x64",
      "--publish",
      "never",
      "-c.mac.notarize=false",
      "-c.dmg.writeUpdateInfo=false",
    ]);

    const env = resolveElectronBuilderEnv(false, {
      APPLE_ID: "apple-id",
      CSC_LINK: "certificate",
      PATH: "/bin",
    });

    expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false");
    expect(env.APPLE_ID).toBeUndefined();
    expect(env.CSC_LINK).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("keeps release artifact selection platform-specific", () => {
    expect(isReleaseArtifact("linux", "OpenDucktor-Electron-0.3.1-linux-x64.AppImage")).toBe(true);
    expect(isReleaseArtifact("linux", "OpenDucktor-Electron-0.3.1-linux-x64.deb")).toBe(true);
    expect(isReleaseArtifact("linux", "OpenDucktor-Electron-0.3.1-linux-x64.dmg")).toBe(false);
    expect(isReleaseArtifact("macos", "OpenDucktor-Electron-0.3.1-mac-arm64.dmg")).toBe(true);
    expect(isReleaseArtifact("macos", "OpenDucktor-Electron-0.3.1-mac-arm64.dmg.blockmap")).toBe(
      true,
    );
    expect(isReleaseArtifact("macos", "OpenDucktor-Electron-0.3.1-mac-arm64.zip")).toBe(true);
    expect(isReleaseArtifact("macos", "OpenDucktor.app")).toBe(false);
    expect(isReleaseArtifact("macos", "builder-debug.yml")).toBe(false);
    expect(isReleaseArtifact("windows", "OpenDucktor-Electron-0.3.1-windows-x64.exe")).toBe(true);
    expect(isReleaseArtifact("windows", "OpenDucktor-Electron-0.3.1-windows-x64.AppImage")).toBe(
      false,
    );
  });

  it("copies only platform release artifacts into the publish directory", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      await mkdir(releaseDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(releaseDirectory, "OpenDucktor-Electron-0.3.1-mac-arm64.dmg"), "dmg"),
        writeFile(join(releaseDirectory, "OpenDucktor-Electron-0.3.1-linux-x64.AppImage"), "app"),
      ]);

      const artifacts = await collectReleaseArtifacts({
        outputDirectory,
        platform: "macos",
        releaseDirectory,
      });

      expect(artifacts.map((artifact) => basename(artifact)).sort()).toEqual([
        "OpenDucktor-Electron-0.3.1-mac-arm64.dmg",
      ]);
      const outputEntries = await readdir(outputDirectory);
      expect(outputEntries).toEqual(["OpenDucktor-Electron-0.3.1-mac-arm64.dmg"]);
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });
});
