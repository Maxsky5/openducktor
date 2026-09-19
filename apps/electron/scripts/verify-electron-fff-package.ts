import { realpathSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { statFile } from "@electron/asar";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";
import { resolvePackagedAppResourcesDirectory } from "./electron-packaged-layout";
import {
  resolveHostReleaseArch,
  resolveHostReleasePlatform,
  type ElectronReleaseArch,
  type ElectronReleasePlatform,
} from "./electron-release-targets";

const probeScanTimeoutMs = 5_000;
const probeFileName = "openducktor-fff-package-check.txt";
const fffPackageArchiveEntry = "node_modules/@ff-labs/fff-node/package.json";

type VerifyPackagedFffFileSearchHost = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
};

type VerifyPackagedFffFileSearchInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
  host?: VerifyPackagedFffFileSearchHost | undefined;
};

type PackagedFffErrorDetails = { readonly nodeModulesDirectory: string };

export type VerifiedPackagedFffFileSearch = {
  modulePath: string;
};

export const resolvePackagedFffNodeModulesDirectory = ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedFffFileSearchInput): string =>
  join(
    resolvePackagedAppResourcesDirectory({ arch, platform, releaseDirectory }),
    "app.asar.unpacked",
    "node_modules",
  );

export const verifyPackagedFffFileSearchEffect = ({
  arch,
  platform,
  releaseDirectory,
  host,
}: VerifyPackagedFffFileSearchInput): Effect.Effect<
  VerifiedPackagedFffFileSearch,
  ElectronOperationError<PackagedFffErrorDetails>
> => {
  const verifyHost = host ?? {
    arch: resolveHostReleaseArch(process.arch),
    platform: resolveHostReleasePlatform(process.platform),
  };
  const resourcesDirectory = resolvePackagedAppResourcesDirectory({
    arch,
    platform,
    releaseDirectory,
  });
  const nodeModulesDirectory = resolvePackagedFffNodeModulesDirectory({
    arch,
    platform,
    releaseDirectory,
  });
  if (verifyHost.platform !== platform || verifyHost.arch !== arch) {
    return Effect.fail(
      new ElectronOperationError({
        operation: "electron.fff.verify-packaged",
        message: `The packaged Claude file search payload for ${platform} ${arch} must be verified on a matching host. This host is ${verifyHost.platform} ${verifyHost.arch}. Build the package on a ${platform} ${arch} host.`,
        arch,
        path: nodeModulesDirectory,
        platform,
        details: { nodeModulesDirectory },
      }),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      await assertPackagedAsarContainsFff(join(resourcesDirectory, "app.asar"), platform, arch);
      const loaded = loadPackagedFffModule(nodeModulesDirectory);
      await probePackagedFffScan(loaded.module);
      return { modulePath: loaded.modulePath };
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.fff.verify-packaged",
        message: `Invalid packaged Claude file search payload for ${platform}: ${errorMessage(
          cause,
        )}. Expected ${fffPackageArchiveEntry} and its native packages in app.asar, unpacked under ${nodeModulesDirectory}`,
        arch,
        path: nodeModulesDirectory,
        platform,
        cause,
        details: { nodeModulesDirectory },
      }),
  });
};

export const verifyPackagedFffFileSearch = ({
  arch,
  platform,
  releaseDirectory,
  host,
}: VerifyPackagedFffFileSearchInput): Promise<VerifiedPackagedFffFileSearch> =>
  runElectronEffect(verifyPackagedFffFileSearchEffect({ arch, platform, releaseDirectory, host }));

const fffNativePackageNames = (
  platform: ElectronReleasePlatform,
  arch: ElectronReleaseArch,
): string[] => {
  if (platform === "macos") {
    return [`@ff-labs/fff-bin-darwin-${arch}`, `@yuuang/ffi-rs-darwin-${arch}`];
  }
  if (platform === "linux") {
    return [`@ff-labs/fff-bin-linux-${arch}-gnu`, `@yuuang/ffi-rs-linux-${arch}-gnu`];
  }
  return [`@ff-labs/fff-bin-win32-${arch}`, `@yuuang/ffi-rs-win32-${arch}-msvc`];
};

const requiredUnpackedArchiveEntries = (
  platform: ElectronReleasePlatform,
  arch: ElectronReleaseArch,
): string[] => [
  fffPackageArchiveEntry,
  "node_modules/ffi-rs/package.json",
  ...fffNativePackageNames(platform, arch).map(
    (packageName) => `node_modules/${packageName}/package.json`,
  ),
];

const assertPackagedAsarContainsFff = async (
  asarPath: string,
  platform: ElectronReleasePlatform,
  arch: ElectronReleaseArch,
): Promise<void> => {
  const metadata = await stat(asarPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`expected a non-empty app.asar archive at ${asarPath}`);
  }
  for (const entry of requiredUnpackedArchiveEntries(platform, arch)) {
    let info: ReturnType<typeof statFile>;
    try {
      info = statFile(asarPath, entry);
    } catch (cause) {
      throw new Error(`the app.asar archive does not contain ${entry}`, { cause });
    }
    if (info.unpacked !== true) {
      throw new Error(`the app.asar archive does not unpack ${entry}`);
    }
  }
};

type LoadedPackagedFffModule = {
  modulePath: string;
  module: typeof import("@ff-labs/fff-node");
};

const loadPackagedFffModule = (nodeModulesDirectory: string): LoadedPackagedFffModule => {
  const requireFromPackagedApp = createRequire(join(nodeModulesDirectory, "package.json"));
  const modulePath = requireFromPackagedApp.resolve("@ff-labs/fff-node");
  const relativeModulePath = relative(realpathSync(nodeModulesDirectory), realpathSync(modulePath));
  if (relativeModulePath.startsWith("..") || isAbsolute(relativeModulePath)) {
    throw new Error(
      `resolved the Claude file search module outside the packaged app: ${modulePath}`,
    );
  }
  // SAFETY: The resolved path points at the @ff-labs/fff-node entry, so the
  // loaded value has the package API type.
  const module = requireFromPackagedApp(modulePath) as typeof import("@ff-labs/fff-node");
  return { modulePath, module };
};

const probePackagedFffScan = async (module: typeof import("@ff-labs/fff-node")): Promise<void> => {
  const workspace = await mkdtemp(join(tmpdir(), "openducktor-fff-package-check-"));
  try {
    await writeFile(join(workspace, probeFileName), "openducktor\n");
    const created = module.FileFinder.create({ basePath: workspace });
    if (!created.ok) {
      throw new Error(`FileFinder.create failed: ${created.error}`);
    }
    const finder = created.value;
    try {
      const completed = await finder.waitForScan(probeScanTimeoutMs);
      if (!completed.ok) {
        throw new Error(`waitForScan failed: ${completed.error}`);
      }
      if (!completed.value) {
        throw new Error(`waitForScan did not finish within ${probeScanTimeoutMs} ms`);
      }
      const result = finder.mixedSearch(probeFileName, { pageSize: 5 });
      if (!result.ok) {
        throw new Error(`mixedSearch failed: ${result.error}`);
      }
      const found = result.value.items.some(
        (entry) => entry.type === "file" && entry.item.fileName === probeFileName,
      );
      if (!found) {
        throw new Error(`the native scan did not find ${probeFileName}`);
      }
    } finally {
      finder.destroy();
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
};
