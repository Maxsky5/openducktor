import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { configureElectronAppIdentity, resolveElectronProfilePath } from "./electron-app-identity";

const customAppName = "Custom App";
const customConfigPath = "/Users/alice/.openducktor-local";
const customProfilePath = resolveElectronProfilePath(customConfigPath);

describe("resolveElectronProfilePath", () => {
  test("stores Electron profile data under the OpenDucktor config directory", () => {
    expect(resolveElectronProfilePath("/Users/alice/.openducktor/")).toBe(
      path.join("/Users/alice/.openducktor/", "electron-profile"),
    );
  });

  test("keeps default and local config directories on separate profiles", () => {
    expect(resolveElectronProfilePath("/Users/alice/.openducktor")).toBe(
      path.join("/Users/alice/.openducktor", "electron-profile"),
    );
    expect(resolveElectronProfilePath("/Users/alice/.openducktor-local")).toBe(
      path.join("/Users/alice/.openducktor-local", "electron-profile"),
    );
  });

  test("resolves relative config directories to absolute Electron profile paths", () => {
    expect(resolveElectronProfilePath("./.openducktor-local")).toBe(
      path.resolve("./.openducktor-local", "electron-profile"),
    );
  });
});

describe("configureElectronAppIdentity", () => {
  test("pins Chromium storage paths to the resolved OpenDucktor config profile", () => {
    const calls: Array<[string, string]> = [];

    configureElectronAppIdentity(
      {
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      {
        appName: customAppName,
        processEnv: { OPENDUCKTOR_CONFIG_DIR: customConfigPath },
        createDirectory(profilePath) {
          calls.push(["mkdir", profilePath]);
        },
      },
    );

    expect(calls).toEqual([
      ["name", customAppName],
      ["mkdir", customProfilePath],
      ["userData", customProfilePath],
      ["sessionData", customProfilePath],
    ]);
  });

  test("expands quoted home-relative config directories before selecting the profile", () => {
    const calls: Array<[string, string]> = [];
    const expectedProfilePath = path.join(homedir(), ".openducktor-local", "electron-profile");

    configureElectronAppIdentity(
      {
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      {
        appName: customAppName,
        processEnv: { OPENDUCKTOR_CONFIG_DIR: ` "~/.openducktor-local" ` },
        createDirectory(profilePath) {
          calls.push(["mkdir", profilePath]);
        },
      },
    );

    expect(calls).toEqual([
      ["name", customAppName],
      ["mkdir", expectedProfilePath],
      ["userData", expectedProfilePath],
      ["sessionData", expectedProfilePath],
    ]);
  });

  test("uses the default OpenDucktor config profile when the config env is unset", () => {
    const calls: Array<[string, string]> = [];
    const expectedProfilePath = path.join(homedir(), ".openducktor", "electron-profile");

    configureElectronAppIdentity(
      {
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      {
        appName: customAppName,
        processEnv: {},
        createDirectory(profilePath) {
          calls.push(["mkdir", profilePath]);
        },
      },
    );

    expect(calls).toEqual([
      ["name", customAppName],
      ["mkdir", expectedProfilePath],
      ["userData", expectedProfilePath],
      ["sessionData", expectedProfilePath],
    ]);
  });

  test("pins relative configured profile paths to absolute storage paths", () => {
    const calls: Array<[string, string]> = [];
    const expectedProfilePath = path.resolve("./.openducktor-local", "electron-profile");

    configureElectronAppIdentity(
      {
        setName(name) {
          calls.push(["name", name]);
        },
        setPath(name, value) {
          calls.push([name, value]);
        },
      },
      {
        appName: customAppName,
        processEnv: { OPENDUCKTOR_CONFIG_DIR: "./.openducktor-local" },
        createDirectory(profilePath) {
          calls.push(["mkdir", profilePath]);
        },
      },
    );

    expect(calls).toEqual([
      ["name", customAppName],
      ["mkdir", expectedProfilePath],
      ["userData", expectedProfilePath],
      ["sessionData", expectedProfilePath],
    ]);
  });

  test("surfaces profile directory creation failures with the app name and profile path", () => {
    expect(() =>
      configureElectronAppIdentity(
        {
          setName() {},
          setPath() {
            throw new Error("setPath should not run after mkdir failure");
          },
        },
        {
          appName: customAppName,
          processEnv: { OPENDUCKTOR_CONFIG_DIR: customConfigPath },
          createDirectory() {
            throw new Error("permission denied");
          },
        },
      ),
    ).toThrow(
      `Failed to prepare Custom App Electron profile directory at ${customProfilePath}: permission denied`,
    );
  });

  test("surfaces non-Error profile directory creation failures", () => {
    expect(() =>
      configureElectronAppIdentity(
        {
          setName() {},
          setPath() {
            throw new Error("setPath should not run after mkdir failure");
          },
        },
        {
          appName: customAppName,
          processEnv: { OPENDUCKTOR_CONFIG_DIR: customConfigPath },
          createDirectory() {
            throw "permission denied";
          },
        },
      ),
    ).toThrow(
      `Failed to prepare Custom App Electron profile directory at ${customProfilePath}: permission denied`,
    );
  });

  test("surfaces config resolution failures with the app name", () => {
    const calls: Array<[string, string]> = [];

    expect(() =>
      configureElectronAppIdentity(
        {
          setName(name) {
            calls.push(["name", name]);
          },
          setPath() {
            throw new Error("setPath should not run after config resolution failure");
          },
        },
        {
          appName: customAppName,
          processEnv: { OPENDUCKTOR_CONFIG_DIR: "" },
          createDirectory() {
            throw new Error("mkdir should not run after config resolution failure");
          },
        },
      ),
    ).toThrow(
      "Failed to prepare Custom App Electron profile directory: OPENDUCKTOR_CONFIG_DIR is set but empty",
    );
    expect(calls).toEqual([["name", customAppName]]);
  });
});
