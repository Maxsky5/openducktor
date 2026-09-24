import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// SAFETY: The CJS verifier exports verifyPackagedMsalPackage with this signature.
const { verifyPackagedMsalPackage } = require("./verify-electron-msal-package.cjs") as {
  verifyPackagedMsalPackage: (
    resourcesDirectory: string,
    platform?: NodeJS.Platform,
    arch?: string,
  ) => { runtimePath: string };
};
const directories = new Set<string>();

const writeFixtureFile = async (path: string, contents = "fixture"): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
};

const makeResources = async (): Promise<string> => {
  const resources = await mkdtemp(join(tmpdir(), "openducktor-msal-package-"));
  directories.add(resources);
  const appAsar = join(resources, "app.asar");
  const unpacked = join(resources, "app.asar.unpacked");
  await Promise.all([
    writeFixtureFile(join(appAsar, "package.json"), "{}"),
    writeFixtureFile(
      join(appAsar, "node_modules", "@azure", "msal-node-runtime", "package.json"),
      JSON.stringify({ main: "dist/index.cjs" }),
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "@azure", "msal-node-runtime", "dist", "index.cjs"),
      "module.exports = { msalNodeRuntime: {} };",
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "@azure", "msal-node-extensions", "package.json"),
      JSON.stringify({ main: "index.cjs" }),
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "@azure", "msal-node-extensions", "index.cjs"),
      `module.exports = Object.fromEntries([
        "PersistenceCachePlugin", "PersistenceCreator", "KeychainPersistence",
        "LibSecretPersistence", "FilePersistenceWithDataProtection"
      ].map((name) => [name, class {}]));`,
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "@azure", "msal-node-extensions", "dist", "index.mjs"),
      "export class PersistenceCachePlugin {} export class PersistenceCreator {}",
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "keytar", "package.json"),
      JSON.stringify({ main: "index.cjs" }),
    ),
    writeFixtureFile(
      join(appAsar, "node_modules", "keytar", "index.cjs"),
      "module.exports = { getPassword() {}, setPassword() {} };",
    ),
    writeFixtureFile(join(unpacked, "node_modules", "keytar", "build", "Release", "keytar.node")),
  ]);
  return resources;
};

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.clear();
});

describe("verifyPackagedMsalPackage", () => {
  test("loads persistence and keytar from a package without broker binaries", async () => {
    const resources = await makeResources();

    expect(verifyPackagedMsalPackage(resources, "darwin").runtimePath).toContain(
      "msal-node-runtime",
    );
    expect(verifyPackagedMsalPackage(resources, "linux").runtimePath).toContain(
      "msal-node-runtime",
    );
  });

  test.each(["app.asar", "app.asar.unpacked"])(
    "rejects broker binaries in %s",
    async (location) => {
      const resources = await makeResources();
      await writeFixtureFile(
        join(
          resources,
          location,
          "node_modules",
          "@azure",
          "msal-node-runtime",
          "dist",
          "macos",
          "arm64",
          "msal-node-runtime.node",
        ),
      );

      expect(() => verifyPackagedMsalPackage(resources, "darwin")).toThrow(
        "Unused MSAL broker binaries returned to the package",
      );
    },
  );

  test("rejects a missing keytar native file", async () => {
    const resources = await makeResources();
    await rm(
      join(
        resources,
        "app.asar.unpacked",
        "node_modules",
        "keytar",
        "build",
        "Release",
        "keytar.node",
      ),
    );

    expect(() => verifyPackagedMsalPackage(resources, "darwin")).toThrow(
      "Packaged MSAL persistence file is missing",
    );
  });

  test("rejects a missing runtime JavaScript entry", async () => {
    const resources = await makeResources();
    await rm(
      join(
        resources,
        "app.asar",
        "node_modules",
        "@azure",
        "msal-node-runtime",
        "dist",
        "index.cjs",
      ),
    );

    expect(() => verifyPackagedMsalPackage(resources, "darwin")).toThrow(
      "Packaged MSAL persistence file is missing",
    );
  });

  test("rejects a missing Windows DPAPI native file", async () => {
    const resources = await makeResources();

    expect(() => verifyPackagedMsalPackage(resources, "win32", "x64")).toThrow(
      "Packaged MSAL persistence file is missing",
    );
  });
});
