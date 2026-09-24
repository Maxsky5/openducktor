import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolvePackagedFffNodeModulesDirectory,
  verifyPackagedFffFileSearch,
} from "./verify-electron-fff-package";

const releaseDirectories = new Set<string>();
const probeFileName = "openducktor-fff-package-check.txt";

const caughtError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause), { cause });

const makeReleaseDirectory = async (): Promise<string> => {
  const releaseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-fff-"));
  releaseDirectories.add(releaseDirectory);
  return releaseDirectory;
};

afterEach(async () => {
  await Promise.all(
    Array.from(releaseDirectories, (releaseDirectory) =>
      rm(releaseDirectory, { force: true, recursive: true }),
    ),
  );
  releaseDirectories.clear();
});

const fffModuleSource = (finder: string): string =>
  `module.exports = { FileFinder: { create: () => (${finder}) } };\n`;

const successfulFinder = `{
  ok: true,
  value: {
    waitForScan: async () => ({ ok: true, value: true }),
    mixedSearch: (query) => ({
      ok: true,
      value: {
        items: [{ type: "file", item: { relativePath: query, fileName: query } }],
        scores: [],
        totalMatched: 1,
        totalFiles: 1,
        totalDirs: 0,
      },
    }),
    destroy: () => {},
  },
}`;

const timedOutFinder = `{
  ok: true,
  value: {
    waitForScan: async () => ({ ok: true, value: false }),
    mixedSearch: () => ({ ok: true, value: { items: [] } }),
    destroy: () => {},
  },
}`;

const finderWithoutProbeResult = `{
  ok: true,
  value: {
    waitForScan: async () => ({ ok: true, value: true }),
    mixedSearch: () => ({ ok: true, value: { items: [] } }),
    destroy: () => {},
  },
}`;

type TestPlatform = "linux" | "macos" | "windows";

const nativePackageNamesByPlatform = {
  linux: ["@ff-labs/fff-bin-linux-x64-gnu", "@yuuang/ffi-rs-linux-x64-gnu"],
  macos: ["@ff-labs/fff-bin-darwin-x64", "@yuuang/ffi-rs-darwin-x64"],
  windows: ["@ff-labs/fff-bin-win32-x64", "@yuuang/ffi-rs-win32-x64-msvc"],
} satisfies Record<TestPlatform, string[]>;

const writePackageFile = async (
  nodeModulesDirectory: string,
  packageName: string,
): Promise<void> => {
  const packageDirectory = join(nodeModulesDirectory, ...packageName.split("/"));
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ name: packageName }));
};

const writePackagedFffModule = async ({
  platform,
  releaseDirectory,
  source,
  omitNativePackage = false,
}: {
  platform: TestPlatform;
  releaseDirectory: string;
  source: string;
  omitNativePackage?: boolean;
}): Promise<string> => {
  const nodeModulesDirectory = resolvePackagedFffNodeModulesDirectory({
    arch: "x64",
    platform,
    releaseDirectory,
  });
  const moduleDirectory = join(nodeModulesDirectory, "@ff-labs", "fff-node");
  await mkdir(moduleDirectory, { recursive: true });
  await writeFile(
    join(moduleDirectory, "package.json"),
    JSON.stringify({ name: "@ff-labs/fff-node", main: "index.cjs" }),
  );
  await writeFile(join(moduleDirectory, "index.cjs"), source);
  await writePackageFile(nodeModulesDirectory, "ffi-rs");
  if (!omitNativePackage) {
    for (const packageName of nativePackageNamesByPlatform[platform]) {
      await writePackageFile(nodeModulesDirectory, packageName);
    }
  }
  return moduleDirectory;
};

const verifyPayload = (
  platform: TestPlatform,
  releaseDirectory: string,
): Promise<{ modulePath: string }> =>
  verifyPackagedFffFileSearch({
    arch: "x64",
    platform,
    releaseDirectory,
    host: { arch: "x64", platform },
  });

describe("resolvePackagedFffNodeModulesDirectory", () => {
  test("resolves the unpacked node modules of the packaged app", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    expect(
      resolvePackagedFffNodeModulesDirectory({
        arch: "arm64",
        platform: "macos",
        releaseDirectory,
      }),
    ).toBe(
      join(
        releaseDirectory,
        "mac-arm64",
        "OpenDucktor.app",
        "Contents",
        "Resources",
        "app.asar.unpacked",
        "node_modules",
      ),
    );
    expect(
      resolvePackagedFffNodeModulesDirectory({
        arch: "x64",
        platform: "windows",
        releaseDirectory,
      }),
    ).toBe(
      join(releaseDirectory, "win-unpacked", "resources", "app.asar.unpacked", "node_modules"),
    );
  });
});

describe("verifyPackagedFffFileSearch", () => {
  test("accepts a packaged payload that loads and finds the probe file", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const moduleDirectory = await writePackagedFffModule({
      platform: "linux",
      releaseDirectory,
      source: fffModuleSource(successfulFinder),
    });

    const verified = await verifyPayload("linux", releaseDirectory);
    expect(realpathSync(verified.modulePath)).toBe(
      realpathSync(join(moduleDirectory, "index.cjs")),
    );
  });

  test("rejects a missing packaged payload with the expected location", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    const error = await verifyPayload("linux", releaseDirectory).catch(caughtError);

    expect(error).toMatchObject({
      _tag: "ElectronOperationError",
      operation: "electron.fff.verify-packaged",
    });
    if (!(error instanceof Error)) {
      throw new TypeError("Expected an Error instance.");
    }
    expect(error.message).toContain(
      join(releaseDirectory, "linux-unpacked", "resources", "app.asar.unpacked", "node_modules"),
    );
  });

  test("rejects a target that does not match the host", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    await expect(
      verifyPackagedFffFileSearch({
        arch: "x64",
        platform: "linux",
        releaseDirectory,
        host: { arch: "arm64", platform: "macos" },
      }),
    ).rejects.toThrow("must be verified on a matching host");
  });

  test("rejects a payload that is missing a native package", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "linux",
      releaseDirectory,
      source: fffModuleSource(successfulFinder),
      omitNativePackage: true,
    });

    await expect(verifyPayload("linux", releaseDirectory)).rejects.toThrow("fff-bin-linux-x64-gnu");
  });

  test("rejects a payload whose native package resolves outside the packaged app", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "linux",
      releaseDirectory,
      source: fffModuleSource(successfulFinder),
      omitNativePackage: true,
    });
    await writePackageFile(
      join(releaseDirectory, "node_modules"),
      "@ff-labs/fff-bin-linux-x64-gnu",
    );

    await expect(verifyPayload("linux", releaseDirectory)).rejects.toThrow(
      "outside the packaged app",
    );
  });

  test("rejects a payload that resolves outside the packaged app", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "linux",
      releaseDirectory,
      source: fffModuleSource(successfulFinder),
    });
    const nodeModulesDirectory = resolvePackagedFffNodeModulesDirectory({
      arch: "x64",
      platform: "linux",
      releaseDirectory,
    });
    await rm(join(nodeModulesDirectory, "@ff-labs", "fff-node"), { force: true, recursive: true });
    await writePackageFile(join(releaseDirectory, "node_modules"), "@ff-labs/fff-node");
    await writeFile(
      join(releaseDirectory, "node_modules", "@ff-labs", "fff-node", "index.cjs"),
      fffModuleSource(successfulFinder),
    );

    await expect(verifyPayload("linux", releaseDirectory)).rejects.toThrow(
      "outside the packaged app",
    );
  });

  test("rejects a payload that fails to create the finder", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "macos",
      releaseDirectory,
      source: fffModuleSource(`{ ok: false, error: 'native library missing' }`),
    });

    await expect(verifyPayload("macos", releaseDirectory)).rejects.toThrow(
      "native library missing",
    );
  });

  test("rejects a payload whose scan times out", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "macos",
      releaseDirectory,
      source: fffModuleSource(timedOutFinder),
    });

    await expect(verifyPayload("macos", releaseDirectory)).rejects.toThrow("did not finish within");
  });

  test("rejects a payload whose scan does not find the probe file", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "windows",
      releaseDirectory,
      source: fffModuleSource(finderWithoutProbeResult),
    });

    await expect(verifyPayload("windows", releaseDirectory)).rejects.toThrow(
      `did not find ${probeFileName}`,
    );
  });
});
