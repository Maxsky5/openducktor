import { describe, expect, test } from "bun:test";
import packageJson from "./package.json";
import { resolveAppVersion } from "./vite.config";

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
});
