import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
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
      const loaded = loadPackagedFffModule({ arch, nodeModulesDirectory, platform });
      await probePackagedFffScan(loaded.module);
      return { modulePath: loaded.modulePath };
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.fff.verify-packaged",
        message: `Invalid packaged Claude file search payload for ${platform}: ${errorMessage(
          cause,
        )}. Expected the file search package and its native packages unpacked under ${nodeModulesDirectory}`,
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

const packagedDependencyRequests = (
  platform: ElectronReleasePlatform,
  arch: ElectronReleaseArch,
): string[] => [
  "ffi-rs/package.json",
  ...fffNativePackageNames(platform, arch).map((packageName) => `${packageName}/package.json`),
];

const resolvePackagedModulePath = (
  requireFromPackagedApp: NodeRequire,
  request: string,
  nodeModulesDirectory: string,
): string => {
  const modulePath = requireFromPackagedApp.resolve(request);
  const relativeModulePath = relative(realpathSync(nodeModulesDirectory), realpathSync(modulePath));
  if (relativeModulePath.startsWith("..") || isAbsolute(relativeModulePath)) {
    throw new Error(`resolved ${request} outside the packaged app: ${modulePath}`);
  }
  return modulePath;
};

type LoadedPackagedFffModule = {
  modulePath: string;
  module: typeof import("@ff-labs/fff-node");
};

const loadPackagedFffModule = ({
  arch,
  nodeModulesDirectory,
  platform,
}: {
  arch: ElectronReleaseArch;
  nodeModulesDirectory: string;
  platform: ElectronReleasePlatform;
}): LoadedPackagedFffModule => {
  const requireFromPackagedApp = createRequire(join(nodeModulesDirectory, "package.json"));
  const modulePath = resolvePackagedModulePath(
    requireFromPackagedApp,
    "@ff-labs/fff-node",
    nodeModulesDirectory,
  );
  for (const request of packagedDependencyRequests(platform, arch)) {
    resolvePackagedModulePath(requireFromPackagedApp, request, nodeModulesDirectory);
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
