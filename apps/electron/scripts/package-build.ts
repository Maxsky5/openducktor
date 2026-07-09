import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "@openducktor/build-tools";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  ElectronValidationError,
  errorMessage,
} from "../src/effect/electron-errors";
import {
  electronBuilderPlatformFlags,
  isCompanionReleaseArtifact,
  isInstallableReleaseArtifact,
  isReleaseArtifact,
  isUpdateMetadataArtifact,
  localElectronPackageTargets,
  requiredUpdateMetadataLabels,
} from "./electron-release-artifacts";
import {
  detectHostReleaseArch,
  detectHostReleasePlatform,
  type ElectronReleaseArch,
  type ElectronReleasePlatform,
} from "./electron-release-targets";
import { electronSidecarDisplayName } from "./electron-sidecar-manifest";
import { prepareElectronSidecarsEffect } from "./prepare-electron-sidecars";
import { verifyPackagedElectronSidecarsEffect } from "./verify-electron-sidecar-package";

export { isInstallableReleaseArtifact, isReleaseArtifact, isUpdateMetadataArtifact };

export type ElectronPackageBuildOptions = {
  arch: ElectronReleaseArch;
  electronPackageDirectory: string;
  outputDirectory: string | undefined;
  platform: ElectronReleasePlatform;
  signed: boolean;
  stageReleaseArtifacts: boolean;
  workspaceRoot: string;
};

export const resolveElectronBuilderArgs = ({
  arch,
  platform,
  signed,
  stageReleaseArtifacts,
}: Pick<
  ElectronPackageBuildOptions,
  "arch" | "platform" | "signed" | "stageReleaseArtifacts"
>): string[] => {
  const args = [
    "--config",
    "electron-builder.yml",
    electronBuilderPlatformFlags[platform],
    ...(stageReleaseArtifacts ? [] : localElectronPackageTargets[platform]),
    `--${arch}`,
    "--publish",
    "never",
  ];

  if (!signed && platform === "macos") {
    args.push("-c.mac.notarize=false");
  }

  if (!signed && platform === "windows") {
    args.push("-c.win.signExecutable=false");
  }

  if (!stageReleaseArtifacts && platform === "macos") {
    args.push("-c.dmg.writeUpdateInfo=false");
  }

  return args;
};

export const resolveElectronBuilderEnv = (
  signed: boolean,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const builderEnv = { ...env };

  if (signed) {
    return builderEnv;
  }

  builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete builderEnv.CSC_LINK;
  delete builderEnv.CSC_KEY_PASSWORD;
  delete builderEnv.CSC_NAME;
  delete builderEnv.APPLE_ID;
  delete builderEnv.APPLE_APP_SPECIFIC_PASSWORD;
  delete builderEnv.APPLE_TEAM_ID;

  return builderEnv;
};

const nodeErrorCode = (cause: unknown): string | null =>
  typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;

const readReleaseDirectoryEntriesEffect = (
  releaseDirectory: string,
): Effect.Effect<Dirent<string>[], ElectronOperationError> =>
  Effect.tryPromise({
    try: () => readdir(releaseDirectory, { withFileTypes: true }),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.package.read-release-directory",
        message:
          nodeErrorCode(cause) === "ENOENT"
            ? `Electron release directory is missing: ${releaseDirectory}`
            : errorMessage(cause),
        path: releaseDirectory,
        cause,
      }),
  });

export const collectReleaseArtifactsEffect = ({
  outputDirectory,
  platform,
  releaseDirectory,
}: {
  outputDirectory: string;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
}): Effect.Effect<string[], ElectronOperationError> =>
  Effect.gen(function* () {
    const entries = yield* readReleaseDirectoryEntriesEffect(releaseDirectory);
    yield* Effect.tryPromise({
      try: () => rm(outputDirectory, { force: true, recursive: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.clean-artifact-output",
          message: errorMessage(cause),
          path: outputDirectory,
          cause,
        }),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(outputDirectory, { recursive: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.create-artifact-output",
          message: errorMessage(cause),
          path: outputDirectory,
          cause,
        }),
    });

    const artifactEntries = entries.filter(
      (entry) => entry.isFile() && isReleaseArtifact(platform, entry.name),
    );
    const installableArtifactEntries = artifactEntries.filter((entry) =>
      isInstallableReleaseArtifact(platform, entry.name),
    );
    const updateMetadataEntries = artifactEntries.filter((entry) =>
      isUpdateMetadataArtifact(platform, entry.name),
    );

    if (installableArtifactEntries.length === 0) {
      return yield* Effect.fail(
        new ElectronOperationError({
          operation: "electron.package.collect-release-artifacts",
          message: `No Electron installable release artifacts were produced for ${platform}.`,
          path: releaseDirectory,
          platform,
        }),
      );
    }

    if (updateMetadataEntries.length === 0) {
      return yield* Effect.fail(
        new ElectronOperationError({
          operation: "electron.package.collect-release-artifacts",
          message: `Electron update metadata is missing for ${platform}; expected ${requiredUpdateMetadataLabels[platform]}.`,
          path: releaseDirectory,
          platform,
        }),
      );
    }

    const copiedArtifacts = yield* Effect.all(
      artifactEntries.map((entry) => {
        const sourcePath = join(releaseDirectory, entry.name);
        const targetPath = join(outputDirectory, entry.name);
        return Effect.tryPromise({
          try: async () => {
            await copyFile(sourcePath, targetPath);
            return targetPath;
          },
          catch: (cause) =>
            new ElectronOperationError({
              operation: "electron.package.copy-release-artifact",
              message: errorMessage(cause),
              path: sourcePath,
              cause,
              details: { targetPath },
            }),
        });
      }),
      { concurrency: "unbounded" },
    );

    const copiedCompanionArtifacts = artifactEntries.filter((entry) =>
      isCompanionReleaseArtifact(entry.name),
    );
    if (copiedCompanionArtifacts.length === 0) {
      console.warn(`No Electron updater companion blockmaps were produced for ${platform}.`);
    }

    if (copiedArtifacts.length === 0) {
      return yield* Effect.fail(
        new ElectronOperationError({
          operation: "electron.package.collect-release-artifacts",
          message: `No Electron release artifacts were produced for ${platform}.`,
          path: releaseDirectory,
          platform,
        }),
      );
    }

    return copiedArtifacts;
  });

export const collectReleaseArtifacts = (input: {
  outputDirectory: string;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
}): Promise<string[]> => runElectronEffect(collectReleaseArtifactsEffect(input));

const runPackageCommandEffect = ({
  command,
  cwd,
  env,
  label,
}: Parameters<typeof runCommand>[0]): Effect.Effect<void, ElectronOperationError> =>
  Effect.tryPromise({
    try: () => {
      const input = env === undefined ? { command, cwd, label } : { command, cwd, env, label };
      return runCommand(input);
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.package.run-command",
        message: errorMessage(cause),
        cause,
        details: { command, cwd, label },
      }),
  });

export const buildElectronPackageEffect = ({
  arch,
  electronPackageDirectory,
  outputDirectory,
  platform,
  signed,
  stageReleaseArtifacts,
  workspaceRoot,
}: ElectronPackageBuildOptions): Effect.Effect<
  string[],
  ElectronOperationError | ElectronValidationError
> =>
  Effect.gen(function* () {
    const releaseDirectory = join(electronPackageDirectory, "release");

    yield* Effect.tryPromise({
      try: () => rm(releaseDirectory, { force: true, recursive: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.clean-release-directory",
          message: errorMessage(cause),
          path: releaseDirectory,
          cause,
        }),
    });
    yield* prepareElectronSidecarsEffect({
      arch,
      electronPackageDirectory,
      platform,
      workspaceRoot,
    });

    yield* runPackageCommandEffect({
      command: ["bun", "run", "build"],
      cwd: electronPackageDirectory,
      label: "Electron app build",
    });
    yield* runPackageCommandEffect({
      command: [
        "bun",
        "run",
        "builder",
        "--",
        ...resolveElectronBuilderArgs({ arch, platform, signed, stageReleaseArtifacts }),
      ],
      cwd: electronPackageDirectory,
      env: resolveElectronBuilderEnv(signed, process.env),
      label: "Electron Builder package",
    });

    const verifiedSidecars = yield* verifyPackagedElectronSidecarsEffect({
      arch,
      platform,
      releaseDirectory,
    });
    for (const sidecar of verifiedSidecars) {
      console.log(
        `Verified packaged Electron ${electronSidecarDisplayName(sidecar.id)} sidecar payload: ${
          sidecar.path
        }`,
      );
    }

    if (!stageReleaseArtifacts) {
      return [];
    }

    if (!outputDirectory) {
      return yield* Effect.fail(
        new ElectronValidationError({
          operation: "electron.package.require-output-directory",
          message: "--output-dir is required when staging Electron release artifacts.",
          field: "outputDirectory",
        }),
      );
    }

    return yield* collectReleaseArtifactsEffect({
      outputDirectory,
      platform,
      releaseDirectory,
    });
  });

export const buildElectronPackage = (input: ElectronPackageBuildOptions): Promise<string[]> =>
  runElectronEffect(buildElectronPackageEffect(input));

const readFlagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const parsePlatform = (value: string | undefined): ElectronReleasePlatform => {
  const platform = value ?? detectHostReleasePlatform(process.platform);
  if (platform === "linux" || platform === "macos" || platform === "windows") {
    return platform;
  }

  throw new ElectronValidationError({
    operation: "electron.package.parse-platform",
    message: "Expected --platform to be one of: linux, macos, windows.",
    field: "platform",
    platform: value,
  });
};

const parseArch = (value: string | undefined): ElectronReleaseArch => {
  const arch = value ?? detectHostReleaseArch(process.arch);
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }

  throw new ElectronValidationError({
    operation: "electron.package.parse-arch",
    message: "Expected --arch to be one of: arm64, x64.",
    field: "arch",
    arch: value,
  });
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const stageReleaseArtifacts = hasFlag(args, "--stage-release-artifacts");
    const outputDirectoryValue = readFlagValue(args, "--output-dir");
    const outputDirectory =
      outputDirectoryValue || stageReleaseArtifacts
        ? resolve(electronPackageDirectory, outputDirectoryValue ?? "release-publish")
        : undefined;

    const artifacts = await buildElectronPackage({
      arch: parseArch(readFlagValue(args, "--arch")),
      electronPackageDirectory,
      outputDirectory,
      platform: parsePlatform(readFlagValue(args, "--platform")),
      signed: hasFlag(args, "--signed"),
      stageReleaseArtifacts,
      workspaceRoot,
    });

    if (stageReleaseArtifacts) {
      console.log("Staged Electron release artifacts:");
      for (const artifact of artifacts) {
        console.log(`- ${artifact}`);
      }
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
