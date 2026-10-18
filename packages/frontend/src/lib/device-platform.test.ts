import { describe, expect, test } from "bun:test";
import { readDevicePlatform } from "./device-platform";

describe("readDevicePlatform", () => {
  test.each([
    ["MacIntel", "darwin"],
    ["iPhone", "darwin"],
    ["Win32", "win32"],
    ["Linux x86_64", "linux"],
  ] as const)("maps %s to %s", (navigatorPlatform, platform) => {
    expect(readDevicePlatform(navigatorPlatform)).toBe(platform);
  });
});
