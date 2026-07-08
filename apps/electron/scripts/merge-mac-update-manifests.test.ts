import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { mergeMacUpdateManifests } from "./merge-mac-update-manifests";

describe("merge mac update manifests", () => {
  test("merges arch-specific latest-mac manifests into one canonical manifest", async () => {
    const assetsDirectory = await mkdtemp(join(tmpdir(), "openducktor-mac-manifests-"));
    try {
      await Promise.all([
        writeFile(join(assetsDirectory, "OpenDucktor-0.4.3-mac-arm64.zip"), "arm64 zip"),
        writeFile(join(assetsDirectory, "OpenDucktor-0.4.3-mac-x64.zip"), "x64 zip"),
        writeFile(
          join(assetsDirectory, "latest-mac-arm64.yml"),
          [
            "version: 0.4.3",
            "files:",
            "  - url: OpenDucktor-0.4.3-mac-arm64.zip",
            "    sha512: arm64",
            "path: OpenDucktor-0.4.3-mac-arm64.zip",
            "sha512: arm64",
            "releaseDate: '2026-07-08T22:00:00.000Z'",
          ].join("\n"),
        ),
        writeFile(
          join(assetsDirectory, "latest-mac-x64.yml"),
          [
            "version: 0.4.3",
            "files:",
            "  - url: OpenDucktor-0.4.3-mac-x64.zip",
            "    sha512: x64",
            "path: OpenDucktor-0.4.3-mac-x64.zip",
            "sha512: x64",
            "releaseDate: '2026-07-08T22:00:00.000Z'",
          ].join("\n"),
        ),
      ]);

      const mergedPath = await mergeMacUpdateManifests(assetsDirectory);
      const merged = parse(await readFile(join(assetsDirectory, "latest-mac.yml"), "utf8"));
      const entries = await readdir(assetsDirectory);

      expect(mergedPath).toBe(join(assetsDirectory, "latest-mac.yml"));
      expect(merged.files.map((file: { url: string }) => file.url)).toEqual([
        "OpenDucktor-0.4.3-mac-arm64.zip",
        "OpenDucktor-0.4.3-mac-x64.zip",
      ]);
      expect(entries).toContain("latest-mac.yml");
      expect(entries).not.toContain("latest-mac-arm64.yml");
      expect(entries).not.toContain("latest-mac-x64.yml");
    } finally {
      await rm(assetsDirectory, { force: true, recursive: true });
    }
  });

  test("fails when both mac architectures exist but the manifests do not cover both", async () => {
    const assetsDirectory = await mkdtemp(join(tmpdir(), "openducktor-mac-manifests-"));
    try {
      await mkdir(assetsDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(assetsDirectory, "OpenDucktor-0.4.3-mac-arm64.zip"), "arm64 zip"),
        writeFile(join(assetsDirectory, "OpenDucktor-0.4.3-mac-x64.zip"), "x64 zip"),
        writeFile(
          join(assetsDirectory, "latest-mac-arm64.yml"),
          [
            "version: 0.4.3",
            "files:",
            "  - url: OpenDucktor-0.4.3-mac-arm64.zip",
            "    sha512: arm64",
          ].join("\n"),
        ),
      ]);

      const error = await mergeMacUpdateManifests(assetsDirectory).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Canonical latest-mac.yml must include both arm64 and x64 update files.",
      );
    } finally {
      await rm(assetsDirectory, { force: true, recursive: true });
    }
  });
});
