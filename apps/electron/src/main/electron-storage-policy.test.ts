import { describe, expect, test } from "bun:test";
import { disableElectronKeychainStorage } from "./electron-storage-policy";

describe("disableElectronKeychainStorage", () => {
  test("opts Electron out of keychain-backed Chromium storage", () => {
    const switches: Array<[string, string | undefined]> = [];

    disableElectronKeychainStorage({
      appendSwitch(name, value) {
        switches.push([name, value]);
      },
    });

    expect(switches).toEqual([
      ["use-mock-keychain", undefined],
      ["password-store", "basic"],
    ]);
  });
});
