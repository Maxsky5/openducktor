import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackage, createPackageWithOptions } from "@electron/asar";
import { resolvePackagedAppResourcesDirectory } from "./electron-packaged-layout";
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

const writePackage = async (appDirectory: string, packageName: string): Promise<void> => {
  const packageDirectory = join(appDirectory, "node_modules", ...packageName.split("/"));
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
  const appDirectory = join(releaseDirectory, "asar-source");
  const moduleDirectory = join(appDirectory, "node_modules", "@ff-labs", "fff-node");
  await mkdir(moduleDirectory, { recursive: true });
  await writeFile(
    join(moduleDirectory, "package.json"),
    JSON.stringify({ name: "@ff-labs/fff-node", main: "index.cjs" }),
  );
  await writeFile(join(moduleDirectory, "index.cjs"), source);
  await writePackage(appDirectory, "ffi-rs");
  if (!omitNativePackage) {
    for (const packageName of nativePackageNamesByPlatform[platform]) {
      await writePackage(appDirectory, packageName);
    }
  }
  const resourcesDirectory = resolvePackagedAppResourcesDirectory({
    arch: "x64",
    platform,
    releaseDirectory,
  });
  await mkdir(resourcesDirectory, { recursive: true });
  await createPackageWithOptions(appDirectory, join(resourcesDirectory, "app.asar"), {
    unpack: "**/node_modules/**",
  });
  return join(
    resolvePackagedFffNodeModulesDirectory({ arch: "x64", platform, releaseDirectory }),
    "@ff-labs",
    "fff-node",
  );
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

const writePackagedAsarWithoutFff = async ({
  platform,
  releaseDirectory,
}: {
  platform: "linux" | "macos" | "windows";
  releaseDirectory: string;
}): Promise<void> => {
  const appDirectory = join(releaseDirectory, "asar-source-without-fff");
  await mkdir(appDirectory, { recursive: true });
  await writeFile(join(appDirectory, "index.html"), "<html></html>\n");
  const resourcesDirectory = resolvePackagedAppResourcesDirectory({
    arch: "x64",
    platform,
    releaseDirectory,
  });
  await mkdir(resourcesDirectory, { recursive: true });
  await createPackage(appDirectory, join(resourcesDirectory, "app.asar"));
};

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

    await expect(verifyPayload("linux", releaseDirectory)).resolves.toEqual({
      modulePath: realpathSync(join(moduleDirectory, "index.cjs")),
    });
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

  test("rejects a payload whose archive does not contain the package", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedAsarWithoutFff({ platform: "linux", releaseDirectory });

    await expect(verifyPayload("linux", releaseDirectory)).rejects.toThrow(
      "the app.asar archive does not contain",
    );
  });

  test("rejects a payload whose archive does not contain a native package", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedFffModule({
      platform: "linux",
      releaseDirectory,
      source: fffModuleSource(successfulFinder),
      omitNativePackage: true,
    });

    await expect(verifyPayload("linux", releaseDirectory)).rejects.toThrow(
      join("@ff-labs", "fff-bin-linux-x64-gnu"),
    );
  });

  test("rejects a payload that resolves outside the packaged app", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const fallbackModuleDirectory = join(releaseDirectory, "node_modules", "@ff-labs", "fff-node");
    await mkdir(fallbackModuleDirectory, { recursive: true });
    await writeFile(
      join(fallbackModuleDirectory, "package.json"),
      JSON.stringify({ name: "@ff-labs/fff-node", main: "index.cjs" }),
    );
    await writeFile(join(fallbackModuleDirectory, "index.cjs"), fffModuleSource(successfulFinder));
    const packagedReleaseDirectory = join(releaseDirectory, "release");
    await writePackagedFffModule({
      platform: "linux",
      releaseDirectory: packagedReleaseDirectory,
      source: fffModuleSource(successfulFinder),
    });
    await rm(
      join(
        resolvePackagedFffNodeModulesDirectory({
          arch: "x64",
          platform: "linux",
          releaseDirectory: packagedReleaseDirectory,
        }),
        "@ff-labs",
        "fff-node",
      ),
      { force: true, recursive: true },
    );

    await expect(verifyPayload("linux", packagedReleaseDirectory)).rejects.toThrow(
      "resolved the Claude file search module outside the packaged app",
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
