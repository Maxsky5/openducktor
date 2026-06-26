import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./electron-release-targets";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";

type VerifyPackagedElectronSidecarsInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

export type VerifiedPackagedElectronSidecar = {
  id: ElectronSidecarId;
  path: string;
};

type PackagedSidecarInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
  sidecarId: ElectronSidecarId;
};

const unpackedDirectoryName = ({
  arch,
  platform,
}: Pick<PackagedSidecarInput, "arch" | "platform">): string => {
  if (platform === "macos") {
    return arch === "x64" ? "mac" : `mac-${arch}`;
  }

  const prefix = platform === "windows" ? "win" : "linux";
  return arch === "x64" ? `${prefix}-unpacked` : `${prefix}-${arch}-unpacked`;
};

export const resolvePackagedElectronSidecarPath = ({
  arch,
  platform,
  releaseDirectory,
  sidecarId,
}: PackagedSidecarInput): string => {
  const unpackedDirectory = unpackedDirectoryName({ arch, platform });
  if (platform === "macos") {
    return join(
      releaseDirectory,
      unpackedDirectory,
      "OpenDucktor.app",
      "Contents",
      "Resources",
      "bin",
      electronSidecarExecutableName(sidecarId, platform),
    );
  }

  return join(
    releaseDirectory,
    unpackedDirectory,
    "resources",
    "bin",
    electronSidecarExecutableName(sidecarId, platform),
  );
};

const assertPackagedSidecarFileEffect = ({
  path,
  platform,
  sidecarId,
}: {
  path: string;
  platform: ElectronReleasePlatform;
  sidecarId: ElectronSidecarId;
}): Effect.Effect<Stats, ElectronOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new Error("expected a file but found a non-file entry");
      }
      if (metadata.size === 0) {
        throw new Error("expected a non-empty file");
      }
      return metadata;
    },
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.sidecar.verify-packaged",
        message: `Invalid packaged Electron ${electronSidecarDisplayName(
          sidecarId,
        )} sidecar payload for ${platform}: ${errorMessage(cause)}. Expected path: ${path}`,
        path,
        platform,
        cause,
        details: { sidecarId },
      }),
  });

export const verifyPackagedElectronSidecarsEffect = ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedElectronSidecarsInput): Effect.Effect<
  VerifiedPackagedElectronSidecar[],
  ElectronOperationError
> =>
  Effect.gen(function* () {
    const verifiedSidecars: VerifiedPackagedElectronSidecar[] = [];
    for (const sidecarId of ELECTRON_SIDECAR_IDS) {
      const sidecarPath = resolvePackagedElectronSidecarPath({
        arch,
        platform,
        releaseDirectory,
        sidecarId,
      });
      const metadata = yield* assertPackagedSidecarFileEffect({
        path: sidecarPath,
        platform,
        sidecarId,
      });

      if (platform !== "windows" && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
        return yield* Effect.fail(
          new ElectronOperationError({
            operation: "electron.sidecar.verify-packaged-executable",
            message: `Invalid packaged Electron ${electronSidecarDisplayName(sidecarId)} sidecar payload for ${platform}: expected an executable file. Expected path: ${sidecarPath}`,
            path: sidecarPath,
            platform,
            details: { sidecarId },
          }),
        );
      }

      verifiedSidecars.push({ id: sidecarId, path: sidecarPath });
    }

    return verifiedSidecars;
  });

export const verifyPackagedElectronSidecars = ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedElectronSidecarsInput): Promise<VerifiedPackagedElectronSidecar[]> =>
  runElectronEffect(
    verifyPackagedElectronSidecarsEffect({
      arch,
      platform,
      releaseDirectory,
    }),
  );
