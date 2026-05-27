import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_CONFIG_DIR_NAME,
  OPENDUCKTOR_CONFIG_DIR_ENV,
  resolveOpenDucktorBaseDir,
  resolveUserPath,
  stripMatchingQuotes,
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

  test("rejects paths that become empty after trimming and unquoting", () => {
    expect(() => resolveUserPath("   ")).toThrow("Path is empty");
    expect(() => resolveUserPath(`""`)).toThrow("Path is empty");
  });

  test("only strips matching wrapping quotes", () => {
    expect(stripMatchingQuotes(`"~/.openducktor-local"`)).toBe("~/.openducktor-local");
    expect(stripMatchingQuotes(`'~/.openducktor-local'`)).toBe("~/.openducktor-local");
    expect(stripMatchingQuotes(`"~/.openducktor-local'`)).toBe(`"~/.openducktor-local'`);
  });
});
