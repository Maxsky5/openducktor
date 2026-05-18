import { describe, expect, test } from "bun:test";

import { deriveDesktopVersion, expectedVersionForEntry, validateVersion } from "./release-version";

describe("release version helpers", () => {
  test("keeps stable release and desktop versions aligned", () => {
    expect(deriveDesktopVersion("0.4.0")).toBe("0.4.0");
    expect(expectedVersionForEntry("packages/openducktor-web/package.json", "0.4.0")).toBe("0.4.0");
    expect(expectedVersionForEntry("apps/desktop/src-tauri/tauri.conf.json", "0.4.0")).toBe(
      "0.4.0",
    );
  });

  test("keeps prerelease versions on npm packages but uses numeric desktop versions", () => {
    const releaseVersion = "0.4.0-beta.1";

    expect(deriveDesktopVersion(releaseVersion)).toBe("0.4.0");
    expect(expectedVersionForEntry("package.json", releaseVersion)).toBe(releaseVersion);
    expect(expectedVersionForEntry("packages/openducktor-web/package.json", releaseVersion)).toBe(
      releaseVersion,
    );
    expect(expectedVersionForEntry("packages/openducktor-mcp/package.json", releaseVersion)).toBe(
      releaseVersion,
    );
    expect(expectedVersionForEntry("apps/desktop/package.json", releaseVersion)).toBe("0.4.0");
    expect(expectedVersionForEntry("apps/electron/package.json", releaseVersion)).toBe("0.4.0");
    expect(expectedVersionForEntry("apps/desktop/src-tauri/tauri.conf.json", releaseVersion)).toBe(
      "0.4.0",
    );
    expect(
      expectedVersionForEntry(
        "apps/desktop/src-tauri/Cargo.toml [workspace.package]",
        releaseVersion,
      ),
    ).toBe("0.4.0");
    expect(
      expectedVersionForEntry(
        "apps/desktop/src-tauri/Cargo.lock [openducktor-desktop]",
        releaseVersion,
      ),
    ).toBe("0.4.0");
  });

  test("rejects malformed release versions", () => {
    expect(() => validateVersion("0.4")).toThrow();
    expect(() => validateVersion("04.0.0")).toThrow();
    expect(() => validateVersion("0.4.0-beta.1")).not.toThrow();
  });
});
