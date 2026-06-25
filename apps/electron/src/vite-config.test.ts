import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";
import { resolveAppVersion } from "../vite.config";

describe("resolveAppVersion", () => {
  test("uses ODT_APP_VERSION when provided", () => {
    expect(resolveAppVersion({ ODT_APP_VERSION: "9.8.7" })).toBe("9.8.7");
  });

  test("uses the Electron package version when ODT_APP_VERSION is absent", () => {
    expect(resolveAppVersion({})).toBe(packageJson.version);
  });

  test("uses the Electron package version when ODT_APP_VERSION is empty", () => {
    expect(resolveAppVersion({ ODT_APP_VERSION: "" })).toBe(packageJson.version);
  });

  test("uses the Electron package version when ODT_APP_VERSION is blank", () => {
    expect(resolveAppVersion({ ODT_APP_VERSION: "   " })).toBe(packageJson.version);
  });

  test("fails with a typed error when the package version is missing", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-vite-config-"));
    const packageJsonPath = join(tempDirectory, "package.json");

    try {
      await writeFile(packageJsonPath, "{}");
      const error = (() => {
        try {
          resolveAppVersion({}, packageJsonPath);
        } catch (caught) {
          return caught;
        }
        throw new Error("Expected resolveAppVersion to fail.");
      })();

      expect(error).toMatchObject({
        _tag: "ElectronValidationError",
        operation: "electron.config.read-package-version",
        path: packageJsonPath,
      });
      expect((error as Error).message).toBe(`Missing package version in ${packageJsonPath}`);
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});
