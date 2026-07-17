import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { ElectronOperationError } from "../effect/electron-errors";
import {
  configureElectronAppIdentity,
  resolveElectronProfileKind,
  resolveElectronProfilePath,
} from "./electron-app-identity";

const customAppName = "Custom App";
const sampleAbsolutePath = (...segments: string[]): string =>
  path.join(path.parse(process.cwd()).root, ...segments);
const defaultConfigPath = sampleAbsolutePath("Users", "alice", ".openducktor");
const customConfigPath = sampleAbsolutePath("Users", "alice", ".openducktor-local");
const customProfilePath = resolveElectronProfilePath(customConfigPath, "production");

describe("resolveElectronProfileKind", () => {
  test("uses development profiles for unpackaged Electron runtimes", () => {
    expect(resolveElectronProfileKind(false)).toBe("development");
    expect(resolveElectronProfileKind(true)).toBe("production");
  });
});

describe("resolveElectronProfilePath", () => {
  test("stores Electron profile data under the OpenDucktor config directory", () => {
    expect(resolveElectronProfilePath(`${defaultConfigPath}${path.sep}`, "production")).toBe(
      path.join(defaultConfigPath, "electron-profile"),
    );
  });

  test("keeps default and local config directories on separate profiles", () => {
    expect(resolveElectronProfilePath(defaultConfigPath, "production")).toBe(
      path.join(defaultConfigPath, "electron-profile"),
    );
    expect(resolveElectronProfilePath(customConfigPath, "production")).toBe(
      path.join(customConfigPath, "electron-profile"),
    );
  });

  test("keeps development Chromium storage separate from the installed app profile", () => {
    expect(resolveElectronProfilePath(defaultConfigPath, "development")).toBe(
      path.join(defaultConfigPath, "electron-profile-dev"),
    );
    expect(resolveElectronProfilePath(defaultConfigPath, "production")).toBe(
      path.join(defaultConfigPath, "electron-profile"),
    );
  });

  test("resolves relative config directories to absolute Electron profile paths", () => {
    expect(resolveElectronProfilePath("./.openducktor-local", "production")).toBe(
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
        profileKind: "production",
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

  test("pins development Chromium storage to its dedicated profile", () => {
    const calls: Array<[string, string]> = [];
    const expectedProfilePath = path.join(customConfigPath, "electron-profile-dev");

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
        profileKind: "development",
        processEnv: { OPENDUCKTOR_CONFIG_DIR: customConfigPath },
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
        profileKind: "production",
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
        profileKind: "production",
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
        profileKind: "production",
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
    const error = (() => {
      try {
        configureElectronAppIdentity(
          {
            setName() {},
            setPath() {
              throw new Error("setPath should not run after mkdir failure");
            },
          },
          {
            appName: customAppName,
            profileKind: "production",
            processEnv: { OPENDUCKTOR_CONFIG_DIR: customConfigPath },
            createDirectory() {
              throw new Error("permission denied");
            },
          },
        );
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected configureElectronAppIdentity to fail.");
    })();

    expect(error).toBeInstanceOf(ElectronOperationError);
    expect(error).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.app-identity.prepare-profile-directory",
      path: customProfilePath,
    });
    expect((error as Error).message).toBe(
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
          profileKind: "production",
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
          profileKind: "production",
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
