import { homedir } from "node:os";
import path from "node:path";
import { HostValidationError } from "../effect/host-errors";
import {
  DEFAULT_CONFIG_DIR_NAME,
  OPENDUCKTOR_CONFIG_DIR_ENV,
  resolveOpenDucktorBaseDir,
  resolveUserPath,
} from "./openducktor-config-dir";

describe("OpenDucktor config directory resolution", () => {
  test("uses the default config directory under the user home", () => {
    expect(resolveOpenDucktorBaseDir({})).toBe(path.join(homedir(), DEFAULT_CONFIG_DIR_NAME));
  });

  test("expands tilde-prefixed configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir({ [OPENDUCKTOR_CONFIG_DIR_ENV]: "~/.openducktor-local" }),
    ).toBe(path.join(homedir(), ".openducktor-local"));
  });

  test("trims and unquotes configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir({
        [OPENDUCKTOR_CONFIG_DIR_ENV]: `  "~/.openducktor-local"  `,
      }),
    ).toBe(path.join(homedir(), ".openducktor-local"));
  });

  test("preserves non-tilde relative configured directories", () => {
    expect(
      resolveOpenDucktorBaseDir({ [OPENDUCKTOR_CONFIG_DIR_ENV]: "./.openducktor-local" }),
    ).toBe("./.openducktor-local");
  });

  test("rejects an empty configured directory", () => {
    expect(() => resolveOpenDucktorBaseDir({ [OPENDUCKTOR_CONFIG_DIR_ENV]: "" })).toThrow(
      "OPENDUCKTOR_CONFIG_DIR is set but empty",
    );
  });

  test("rejects a whitespace-only configured directory with the environment field", () => {
    try {
      resolveOpenDucktorBaseDir({ [OPENDUCKTOR_CONFIG_DIR_ENV]: "   " });
      throw new Error("Expected whitespace-only config dir to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostValidationError);
      expect((error as HostValidationError).field).toBe(OPENDUCKTOR_CONFIG_DIR_ENV);
      expect((error as HostValidationError).message).toContain(
        "OPENDUCKTOR_CONFIG_DIR is set but empty",
      );
    }
  });

  test("rejects quoted empty configured directories with the environment field", () => {
    try {
      resolveOpenDucktorBaseDir({ [OPENDUCKTOR_CONFIG_DIR_ENV]: `"   "` });
      throw new Error("Expected quoted-empty config dir to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostValidationError);
      expect((error as HostValidationError).field).toBe(OPENDUCKTOR_CONFIG_DIR_ENV);
      expect((error as HostValidationError).message).toContain(
        "OPENDUCKTOR_CONFIG_DIR is set but empty",
      );
    }
  });

  test("rejects paths that become empty after trimming and unquoting", () => {
    expect(() => resolveUserPath("   ")).toThrow("Path is empty");
    expect(() => resolveUserPath(`""`)).toThrow("Path is empty");
    expect(() => resolveUserPath(`"   "`)).toThrow("Path is empty");
  });
});
