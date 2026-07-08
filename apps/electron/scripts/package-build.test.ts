import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  collectReleaseArtifacts,
  isInstallableReleaseArtifact,
  isReleaseArtifact,
  isUpdateMetadataArtifact,
  resolveElectronBuilderArgs,
  resolveElectronBuilderEnv,
} from "./package-build";

describe("build Electron release artifact", () => {
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

  it("builds local unsigned Windows packages without signing the executable", () => {
    expect(
      resolveElectronBuilderArgs({
        arch: "x64",
        platform: "windows",
        signed: false,
        stageReleaseArtifacts: false,
      }),
    ).toEqual([
      "--config",
      "electron-builder.yml",
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
      "-c.win.signExecutable=false",
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
    expect(isReleaseArtifact("linux", "OpenDucktor-0.3.1-linux-x64.AppImage")).toBe(true);
    expect(isReleaseArtifact("linux", "OpenDucktor-0.3.1-linux-x64.deb")).toBe(true);
    expect(isReleaseArtifact("linux", "OpenDucktor-0.3.1-linux-x64.dmg")).toBe(false);
    expect(isReleaseArtifact("macos", "OpenDucktor-0.3.1-mac-arm64.dmg")).toBe(true);
    expect(isReleaseArtifact("macos", "OpenDucktor-0.3.1-mac-arm64.dmg.blockmap")).toBe(true);
    expect(isReleaseArtifact("macos", "OpenDucktor-0.3.1-mac-arm64.zip")).toBe(true);
    expect(isReleaseArtifact("macos", "latest-mac.yml")).toBe(true);
    expect(isReleaseArtifact("macos", "latest-mac-x64.yml")).toBe(true);
    expect(isReleaseArtifact("macos", "OpenDucktor.app")).toBe(false);
    expect(isReleaseArtifact("macos", "builder-debug.yml")).toBe(false);
    expect(isReleaseArtifact("windows", "latest.yml")).toBe(true);
    expect(isReleaseArtifact("linux", "latest-linux.yml")).toBe(true);
    expect(isReleaseArtifact("windows", "OpenDucktor-0.3.1-windows-x64.exe")).toBe(true);
    expect(isReleaseArtifact("windows", "OpenDucktor-0.3.1-windows-x64.AppImage")).toBe(false);

    expect(isInstallableReleaseArtifact("macos", "OpenDucktor-0.3.1-mac-arm64.dmg")).toBe(true);
    expect(isInstallableReleaseArtifact("macos", "OpenDucktor-0.3.1-mac-arm64.dmg.blockmap")).toBe(
      false,
    );
    expect(isUpdateMetadataArtifact("macos", "latest-mac.yml")).toBe(true);
    expect(isUpdateMetadataArtifact("macos", "latest.yml")).toBe(false);
  });

  it("copies platform release artifacts and update metadata into the publish directory", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      await mkdir(releaseDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(releaseDirectory, "OpenDucktor-0.3.1-mac-arm64.dmg"), "dmg"),
        writeFile(join(releaseDirectory, "OpenDucktor-0.3.1-mac-arm64.dmg.blockmap"), "blockmap"),
        writeFile(join(releaseDirectory, "latest-mac.yml"), "metadata"),
        writeFile(join(releaseDirectory, "OpenDucktor-0.3.1-linux-x64.AppImage"), "app"),
        writeFile(join(releaseDirectory, "latest-linux.yml"), "linux metadata"),
      ]);

      const artifacts = await collectReleaseArtifacts({
        outputDirectory,
        platform: "macos",
        releaseDirectory,
      });

      expect(artifacts.map((artifact) => basename(artifact)).sort()).toEqual([
        "OpenDucktor-0.3.1-mac-arm64.dmg",
        "OpenDucktor-0.3.1-mac-arm64.dmg.blockmap",
        "latest-mac.yml",
      ]);
      const outputEntries = await readdir(outputDirectory);
      expect(outputEntries.sort()).toEqual([
        "OpenDucktor-0.3.1-mac-arm64.dmg",
        "OpenDucktor-0.3.1-mac-arm64.dmg.blockmap",
        "latest-mac.yml",
      ]);
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });

  it("preserves release directory read errors that are not missing-directory failures", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      await writeFile(releaseDirectory, "not a directory");

      const error = await collectReleaseArtifacts({
        outputDirectory,
        platform: "macos",
        releaseDirectory,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("Electron release directory is missing");
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });

  it("uses a typed error when the release directory is missing", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      const error = await collectReleaseArtifacts({
        outputDirectory,
        platform: "macos",
        releaseDirectory,
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        _tag: "ElectronOperationError",
        operation: "electron.package.read-release-directory",
        path: releaseDirectory,
      });
      expect((error as Error).message).toBe(
        `Electron release directory is missing: ${releaseDirectory}`,
      );
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });

  it("uses a typed error when no platform installable release artifacts were produced", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      await mkdir(releaseDirectory, { recursive: true });

      const error = await collectReleaseArtifacts({
        outputDirectory,
        platform: "macos",
        releaseDirectory,
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        _tag: "ElectronOperationError",
        operation: "electron.package.collect-release-artifacts",
        path: releaseDirectory,
        platform: "macos",
      });
      expect((error as Error).message).toBe(
        "No Electron installable release artifacts were produced for macos.",
      );
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });

  it("uses a typed error when updater metadata is missing from staged release artifacts", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-release-"));
    const releaseDirectory = join(baseDirectory, "release");
    const outputDirectory = join(baseDirectory, "release-publish");

    try {
      await mkdir(releaseDirectory, { recursive: true });
      await writeFile(join(releaseDirectory, "OpenDucktor-0.3.1-windows-x64.exe"), "installer");

      const error = await collectReleaseArtifacts({
        outputDirectory,
        platform: "windows",
        releaseDirectory,
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        _tag: "ElectronOperationError",
        operation: "electron.package.collect-release-artifacts",
        path: releaseDirectory,
        platform: "windows",
      });
      expect((error as Error).message).toBe(
        "Electron update metadata is missing for windows; expected latest.yml.",
      );
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });
});
