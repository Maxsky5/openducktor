import { describe, expect, test } from "bun:test";
import releasePackageJson from "../../../../package.json";
import { resolveElectronAppVersion } from "./electron-app-version";

describe("resolveElectronAppVersion", () => {
  test("uses the full release version in development", () => {
    expect(
      resolveElectronAppVersion({
        isPackaged: false,
        packagedVersion: "0.6.0",
      }),
    ).toBe(releasePackageJson.version);
  });

  test("uses Electron package metadata in packaged builds", () => {
    expect(
      resolveElectronAppVersion({
        isPackaged: true,
        packagedVersion: "0.6.0-beta.2",
      }),
    ).toBe("0.6.0-beta.2");
  });
});
