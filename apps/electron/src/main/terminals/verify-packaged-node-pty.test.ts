import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const { afterPack, afterSign, resolvePackagedResourcesRoot } = (await import(
  "../../../scripts/verify-packaged-node-pty.mjs"
)) as {
  afterPack: (context: unknown) => Promise<void>;
  afterSign: (context: unknown) => Promise<void>;
  resolvePackagedResourcesRoot: (context: {
    appOutDir: string;
    electronPlatformName: string;
    packager: { appInfo: { productFilename: string } };
  }) => string;
};

describe("verifyPackagedNodePty", () => {
  test("exports both electron-builder lifecycle hooks", () => {
    expect(afterPack).toBeFunction();
    expect(afterSign).toBeFunction();
  });

  test("resolves resources inside the macOS app bundle", () => {
    expect(
      resolvePackagedResourcesRoot({
        appOutDir: "/release/mac-arm64",
        electronPlatformName: "darwin",
        packager: { appInfo: { productFilename: "OpenDucktor" } },
      }),
    ).toBe(join("/release/mac-arm64", "OpenDucktor.app", "Contents", "Resources"));
  });

  test("resolves resources directly under non-macOS output", () => {
    expect(
      resolvePackagedResourcesRoot({
        appOutDir: "C:/release/win-unpacked",
        electronPlatformName: "win32",
        packager: { appInfo: { productFilename: "OpenDucktor" } },
      }),
    ).toBe(join("C:/release/win-unpacked", "resources"));
  });
});
