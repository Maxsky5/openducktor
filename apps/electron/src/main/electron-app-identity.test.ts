import { describe, expect, test } from "bun:test";
import { configureElectronAppIdentity } from "./electron-app-identity";

describe("configureElectronAppIdentity", () => {
  test("pins Chromium storage paths to the OpenDucktor app profile", () => {
    const calls: Array<[string, string]> = [];

    configureElectronAppIdentity(
      {
        getPath(name) {
          expect(name).toBe("appData");
          return "/Users/alice/Library/Application Support";
        },
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      "OpenDucktor",
      (profilePath) => {
        calls.push(["mkdir", profilePath]);
      },
    );

    expect(calls).toEqual([
      ["name", "OpenDucktor"],
      ["mkdir", "/Users/alice/Library/Application Support/OpenDucktor"],
      ["userData", "/Users/alice/Library/Application Support/OpenDucktor"],
      ["sessionData", "/Users/alice/Library/Application Support/OpenDucktor"],
    ]);
  });

  test("surfaces profile directory creation failures with the profile path", () => {
    expect(() =>
      configureElectronAppIdentity(
        {
          getPath() {
            return "/Users/alice/Library/Application Support";
          },
          setName() {},
          setPath() {
            throw new Error("setPath should not run after mkdir failure");
          },
        },
        "OpenDucktor",
        () => {
          throw new Error("permission denied");
        },
      ),
    ).toThrow(
      "Failed to create OpenDucktor Electron profile directory at /Users/alice/Library/Application Support/OpenDucktor: permission denied",
    );
  });
});
