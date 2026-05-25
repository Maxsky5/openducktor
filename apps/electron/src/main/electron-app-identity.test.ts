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
    );

    expect(calls).toEqual([
      ["name", "OpenDucktor"],
      ["userData", "/Users/alice/Library/Application Support/OpenDucktor"],
      ["sessionData", "/Users/alice/Library/Application Support/OpenDucktor"],
    ]);
  });
});
