import { describe, expect, test } from "bun:test";
import { selectChromeForTestingArchive } from "./chrome-for-testing-pin";

describe("selectChromeForTestingArchive", () => {
  test("selects the pinned archive for each supported host", () => {
    expect(selectChromeForTestingArchive("linux", "x64")?.platform).toBe("linux64");
    expect(selectChromeForTestingArchive("darwin", "arm64")?.platform).toBe("mac-arm64");
    expect(selectChromeForTestingArchive("darwin", "x64")?.platform).toBe("mac-x64");
    expect(selectChromeForTestingArchive("win32", "x64")?.platform).toBe("win64");
  });

  test("returns null for a host that the pinned version does not have", () => {
    expect(selectChromeForTestingArchive("linux", "arm64")).toBeNull();
    expect(selectChromeForTestingArchive("win32", "arm64")).toBeNull();
    expect(selectChromeForTestingArchive("freebsd", "x64")).toBeNull();
  });
});
