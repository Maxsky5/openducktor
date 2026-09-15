import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { HostValidationError } from "../effect/host-errors";
import { resolveOpenDucktorBaseDir, resolveUserPath } from "./openducktor-config-dir";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const PRELOAD_CONFIG_DIR = process.env[OPENDUCKTOR_CONFIG_DIR_ENV];

describe("OpenDucktor config directory resolution", () => {
  test("uses a separate default directory for each scope", () => {
    expect(resolveOpenDucktorBaseDir("production", {})).toBe(path.join(homedir(), ".openducktor"));
    expect(resolveOpenDucktorBaseDir("dev", {})).toBe(path.join(homedir(), ".openducktor-dev"));
    const expectedTestDirectory =
      PRELOAD_CONFIG_DIR ?? path.join(tmpdir(), `openducktor-test-${process.pid}`);
    expect(resolveOpenDucktorBaseDir("test")).toBe(expectedTestDirectory);
    expect(expectedTestDirectory.startsWith(`${tmpdir()}${path.sep}`)).toBe(true);
  });

  test.each(["production", "dev", "test"] as const)(
    "uses OPENDUCKTOR_CONFIG_DIR in the %s scope",
    (scope) => {
      expect(
        resolveOpenDucktorBaseDir(scope, {
          [OPENDUCKTOR_CONFIG_DIR_ENV]: "~/.openducktor-local",
        }),
      ).toBe(path.join(homedir(), ".openducktor-local"));
    },
  );

  test("returns a test directory when the preload override is absent", () => {
    expect(resolveOpenDucktorBaseDir("test", {})).toBe(
      path.join(tmpdir(), `openducktor-test-${process.pid}`),
    );
  });

  test("expands tilde-prefixed configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir("production", {
        [OPENDUCKTOR_CONFIG_DIR_ENV]: "~/.openducktor-local",
      }),
    ).toBe(path.join(homedir(), ".openducktor-local"));
  });

  test("trims and unquotes configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir("production", {
        [OPENDUCKTOR_CONFIG_DIR_ENV]: `  "~/.openducktor-local"  `,
      }),
    ).toBe(path.join(homedir(), ".openducktor-local"));
  });

  test("preserves non-tilde relative configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir("production", {
        [OPENDUCKTOR_CONFIG_DIR_ENV]: "./.openducktor-local",
      }),
    ).toBe("./.openducktor-local");
  });

  test("rejects an empty configured directory", () => {
    expect(() =>
      resolveOpenDucktorBaseDir("production", { [OPENDUCKTOR_CONFIG_DIR_ENV]: "" }),
    ).toThrow("OPENDUCKTOR_CONFIG_DIR is set but empty");
  });

  test("rejects a whitespace-only configured directory with the environment field", () => {
    try {
      resolveOpenDucktorBaseDir("production", { [OPENDUCKTOR_CONFIG_DIR_ENV]: "   " });
      throw new Error("Expected whitespace-only config dir to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostValidationError);
      if (!(error instanceof HostValidationError)) throw error;
      expect(error.field).toBe(OPENDUCKTOR_CONFIG_DIR_ENV);
      expect(error.message).toContain("OPENDUCKTOR_CONFIG_DIR is set but empty");
    }
  });

  test("rejects quoted empty configured directories with the environment field", () => {
    try {
      resolveOpenDucktorBaseDir("production", { [OPENDUCKTOR_CONFIG_DIR_ENV]: `"   "` });
      throw new Error("Expected quoted-empty config dir to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostValidationError);
      if (!(error instanceof HostValidationError)) throw error;
      expect(error.field).toBe(OPENDUCKTOR_CONFIG_DIR_ENV);
      expect(error.message).toContain("OPENDUCKTOR_CONFIG_DIR is set but empty");
    }
  });

  test("rejects paths that become empty after trimming and unquoting", () => {
    expect(() => resolveUserPath("   ")).toThrow("Path is empty");
    expect(() => resolveUserPath(`""`)).toThrow("Path is empty");
    expect(() => resolveUserPath(`"   "`)).toThrow("Path is empty");
  });
});
