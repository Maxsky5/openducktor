import { describe, expect, test } from "bun:test";
import path from "node:path";
import { configureElectronAppIdentity, resolveElectronProfilePath } from "./electron-app-identity";

const customAppName = "Custom App";
const customAppDataPath = "/Users/alice/Library/Application Support";
const customProfilePath = resolveElectronProfilePath(customAppDataPath, customAppName);

describe("resolveElectronProfilePath", () => {
  test("joins app data paths and application names with platform path semantics", () => {
    expect(
      resolveElectronProfilePath("/Users/alice/Library/Application Support/", "Custom App"),
    ).toBe(path.join("/Users/alice/Library/Application Support/", "Custom App"));
  });
});

describe("configureElectronAppIdentity", () => {
  test("pins Chromium storage paths to the provided app profile", () => {
    const calls: Array<[string, string]> = [];

    configureElectronAppIdentity(
      {
        getPath(name) {
          expect(name).toBe("appData");
          return customAppDataPath;
        },
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      customAppName,
      (profilePath) => {
        calls.push(["mkdir", profilePath]);
      },
    );

    expect(calls).toEqual([
      ["name", customAppName],
      ["mkdir", customProfilePath],
      ["userData", customProfilePath],
      ["sessionData", customProfilePath],
    ]);
  });

  test("surfaces profile directory creation failures with the app name and profile path", () => {
    expect(() =>
      configureElectronAppIdentity(
        {
          getPath() {
            return customAppDataPath;
          },
          setName() {},
          setPath() {
            throw new Error("setPath should not run after mkdir failure");
          },
        },
        customAppName,
        () => {
          throw new Error("permission denied");
        },
      ),
    ).toThrow(
      `Failed to create Custom App Electron profile directory at ${customProfilePath}: permission denied`,
    );
  });

  test("surfaces non-Error profile directory creation failures", () => {
    expect(() =>
      configureElectronAppIdentity(
        {
          getPath() {
            return customAppDataPath;
          },
          setName() {},
          setPath() {
            throw new Error("setPath should not run after mkdir failure");
          },
        },
        customAppName,
        () => {
          throw "permission denied";
        },
      ),
    ).toThrow(
      `Failed to create Custom App Electron profile directory at ${customProfilePath}: permission denied`,
    );
  });
});
