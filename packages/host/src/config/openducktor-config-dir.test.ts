import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HostValidationError } from "../effect/host-errors";
import { runFixtureProcess } from "../test-support/fixture-process";
import {
  displayUserPath,
  resolveOpenDucktorBaseDir,
  resolveUserPath,
} from "./openducktor-config-dir";

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

  test("uses an explicit production path in test scope before file safety checks", () => {
    expect(
      resolveOpenDucktorBaseDir("test", {
        [OPENDUCKTOR_CONFIG_DIR_ENV]: "~/.openducktor",
      }),
    ).toBe(path.join(homedir(), ".openducktor"));
  });

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

  test("shortens a displayed path inside the home directory", () => {
    expect(displayUserPath("/home/dev/.openducktor-local/config.json", "/home/dev")).toBe(
      "~/.openducktor-local/config.json",
    );
  });

  test("keeps a displayed path outside the home directory", () => {
    expect(displayUserPath("/tmp/odt/config.json", "/home/dev")).toBe("/tmp/odt/config.json");
    expect(displayUserPath("/home/developer/config.json", "/home/dev")).toBe(
      "/home/developer/config.json",
    );
  });
});

const developmentConfigGuardFixture = new URL(
  "./test-support/development-config-guard-fixture.ts",
  import.meta.url,
);
const productionRefusal = () =>
  expect.stringMatching(
    /refused the production config directory .*\.openducktor\. Set OPENDUCKTOR_CONFIG_DIR.*--allow-production-config/,
  );

test("development requires acknowledgement for the production config root and its aliases", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "odt-development-config-"));
  try {
    await mkdir(path.join(homeDir, "case-probe"));
    const caseInsensitive = existsSync(path.join(homeDir, "CASE-PROBE"));
    const stdout = await runFixtureProcess({
      fixtureUrl: developmentConfigGuardFixture,
      args: [],
      homeDir,
    });
    expect(JSON.parse(stdout)).toEqual({
      directBeforeCreation: productionRefusal(),
      caseAliasBeforeCreation: caseInsensitive ? productionRefusal() : null,
      danglingTarget: productionRefusal(),
      direct: productionRefusal(),
      alias: productionRefusal(),
      acknowledged: null,
      defaultDevelopment: null,
      isolated: null,
      production: null,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

// The web CLI runs under Node, which can report both macOS paths for the same directory.
test.skipIf(process.platform !== "darwin")(
  "development refuses macOS Data volume and Unicode aliases of the production root",
  async () => {
    const homeDir = await mkdtemp("/Users/Shared/odt-development-config-");
    try {
      await mkdir(path.join(homeDir, "case-probe"));
      const caseInsensitive = existsSync(path.join(homeDir, "CASE-PROBE"));
      const result = await Bun.build({
        entrypoints: [fileURLToPath(developmentConfigGuardFixture)],
        target: "node",
        outdir: homeDir,
        naming: "development-config-guard.mjs",
      });
      const bundle = result.outputs[0];
      if (!bundle) throw new Error("The Node config guard fixture bundle is missing.");
      const stdout = await runFixtureProcess({
        fixtureUrl: pathToFileURL(bundle.path),
        executable: "node",
        args: [`/System/Volumes/Data${homeDir}/.openducktor`],
        homeDir,
      });
      expect(JSON.parse(stdout)).toMatchObject({
        filesystemAliasBeforeCreation: productionRefusal(),
        isolatedBeforeCreation: null,
        filesystemAlias: productionRefusal(),
        unicodeAlias: productionRefusal(),
        unicodeCaseAlias: caseInsensitive ? productionRefusal() : null,
        sigmaCaseAlias: caseInsensitive ? productionRefusal() : null,
        expandedCaseAlias: caseInsensitive ? productionRefusal() : null,
        distinctUnicodeName: null,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  },
);
