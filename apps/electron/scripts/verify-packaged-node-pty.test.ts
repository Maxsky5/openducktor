import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { resolvePackagedResourcesRoot } = require("./verify-packaged-node-pty.cjs") as {
  resolvePackagedResourcesRoot: (context: {
    appOutDir: string;
    electronPlatformName: string;
    packager: { appInfo: { productFilename: string } };
  }) => string;
};

describe("verifyPackagedNodePty", () => {
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
