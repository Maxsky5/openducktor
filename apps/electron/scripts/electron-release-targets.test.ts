import { describe, expect, it } from "bun:test";
import { detectHostReleaseArch, detectHostReleasePlatform } from "./electron-release-targets";

describe("Electron release targets", () => {
  it("maps host platform and architecture to Electron release targets", () => {
    expect(detectHostReleasePlatform("darwin")).toBe("macos");
    expect(detectHostReleasePlatform("linux")).toBe("linux");
    expect(detectHostReleasePlatform("win32")).toBe("windows");
    expect(detectHostReleasePlatform("freebsd")).toBeUndefined();
    expect(detectHostReleaseArch("arm64")).toBe("arm64");
    expect(detectHostReleaseArch("x64")).toBe("x64");
    expect(detectHostReleaseArch("ia32")).toBeUndefined();
  });
});
