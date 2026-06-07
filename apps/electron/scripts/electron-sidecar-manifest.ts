import { basename } from "node:path";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./electron-release-targets";

export const ELECTRON_SIDECAR_IDS = ["openducktor-mcp", "beads", "dolt"] as const;
export type ElectronSidecarId = (typeof ELECTRON_SIDECAR_IDS)[number];
export type ExternalElectronSidecarId = Exclude<ElectronSidecarId, "openducktor-mcp">;
export const EXTERNAL_ELECTRON_SIDECAR_IDS = ["beads", "dolt"] as const;
export type ElectronSidecarArchiveType = "tar.gz" | "zip";

export type ElectronExternalSidecarAsset = {
  archiveType: ElectronSidecarArchiveType;
  executablePath: string;
  id: ExternalElectronSidecarId;
  sha256: string;
  url: string;
  version: string;
};

export type ElectronExternalSidecarTarget = {
  arch: ElectronReleaseArch;
  assets: Record<ExternalElectronSidecarId, ElectronExternalSidecarAsset>;
  platform: ElectronReleasePlatform;
};

export const electronSidecarExecutableName = (
  sidecarId: ElectronSidecarId,
  platform: ElectronReleasePlatform,
): string => {
  const executableSuffix = platform === "windows" ? ".exe" : "";

  switch (sidecarId) {
    case "openducktor-mcp":
      return `openducktor-mcp${executableSuffix}`;
    case "beads":
      return `bd${executableSuffix}`;
    case "dolt":
      return `dolt${executableSuffix}`;
  }
};

export const electronSidecarDisplayName = (sidecarId: ElectronSidecarId): string => {
  switch (sidecarId) {
    case "openducktor-mcp":
      return "OpenDucktor MCP";
    case "beads":
      return "Beads";
    case "dolt":
      return "Dolt";
  }
};

const BEADS_RELEASE_BASE_URL = "https://github.com/gastownhall/beads/releases/download/v1.0.5";
const DOLT_RELEASE_BASE_URL = "https://github.com/dolthub/dolt/releases/download/v2.1.2";

const assetUrl = (baseUrl: string, fileName: string): string => `${baseUrl}/${fileName}`;

const beadsAsset = ({
  archiveType,
  executablePath,
  fileName,
  sha256,
}: {
  archiveType: ElectronSidecarArchiveType;
  executablePath: string;
  fileName: string;
  sha256: string;
}): ElectronExternalSidecarAsset => ({
  id: "beads",
  version: "1.0.5",
  url: assetUrl(BEADS_RELEASE_BASE_URL, fileName),
  sha256,
  archiveType,
  executablePath,
});

const doltAsset = ({
  archiveType,
  executablePath,
  fileName,
  sha256,
}: {
  archiveType: ElectronSidecarArchiveType;
  executablePath: string;
  fileName: string;
  sha256: string;
}): ElectronExternalSidecarAsset => ({
  id: "dolt",
  version: "2.1.2",
  url: assetUrl(DOLT_RELEASE_BASE_URL, fileName),
  sha256,
  archiveType,
  executablePath,
});

export const ELECTRON_EXTERNAL_SIDECAR_TARGETS = [
  {
    platform: "macos",
    arch: "x64",
    assets: {
      beads: beadsAsset({
        fileName: "beads_1.0.5_darwin_amd64.tar.gz",
        sha256: "0b0b017a3f2b23a1a9b53056ff160de318ebbca6a991c3db5924f5f48390e490",
        archiveType: "tar.gz",
        executablePath: "bd",
      }),
      dolt: doltAsset({
        fileName: "dolt-darwin-amd64.tar.gz",
        sha256: "2ea3f505c6dba18b5392f59bcd25a6f12be1fe3810000bf218ec8d2fabcf95cb",
        archiveType: "tar.gz",
        executablePath: "dolt-darwin-amd64/bin/dolt",
      }),
    },
  },
  {
    platform: "macos",
    arch: "arm64",
    assets: {
      beads: beadsAsset({
        fileName: "beads_1.0.5_darwin_arm64.tar.gz",
        sha256: "648a2d19d767e8700bee809d4667cb52be3443d877dadb8106be550396982f58",
        archiveType: "tar.gz",
        executablePath: "bd",
      }),
      dolt: doltAsset({
        fileName: "dolt-darwin-arm64.tar.gz",
        sha256: "e42a065e35a7e827b6f0c7359f9c318c768302eec3bc75d202e0c1d2e1d5279c",
        archiveType: "tar.gz",
        executablePath: "dolt-darwin-arm64/bin/dolt",
      }),
    },
  },
  {
    platform: "linux",
    arch: "x64",
    assets: {
      beads: beadsAsset({
        fileName: "beads_1.0.5_linux_amd64.tar.gz",
        sha256: "24706f65c7131c7b3261388709ae8781c8db53f0795398f67aa40538750aacf3",
        archiveType: "tar.gz",
        executablePath: "bd",
      }),
      dolt: doltAsset({
        fileName: "dolt-linux-amd64.tar.gz",
        sha256: "71f2314acfe2aa582f2cc67269e18495d5cc7655ea53237db5510e3617a37838",
        archiveType: "tar.gz",
        executablePath: "dolt-linux-amd64/bin/dolt",
      }),
    },
  },
  {
    platform: "linux",
    arch: "arm64",
    assets: {
      beads: beadsAsset({
        fileName: "beads_1.0.5_linux_arm64.tar.gz",
        sha256: "ccae5eb4478876ae224687ba98baef46848e603470b241966b63ccd3e01129a4",
        archiveType: "tar.gz",
        executablePath: "bd",
      }),
      dolt: doltAsset({
        fileName: "dolt-linux-arm64.tar.gz",
        sha256: "ab5e5d35422dd49f684c4f9de83cb63608ff48c27b4df5cb4b652fa85476ad93",
        archiveType: "tar.gz",
        executablePath: "dolt-linux-arm64/bin/dolt",
      }),
    },
  },
  {
    platform: "windows",
    arch: "x64",
    assets: {
      beads: beadsAsset({
        fileName: "beads_1.0.5_windows_amd64.zip",
        sha256: "3a0e084164d6a1a003ac81f190ec090b1cbfcfead8b8dac7142c68a67b6aa819",
        archiveType: "zip",
        executablePath: "bd.exe",
      }),
      dolt: doltAsset({
        fileName: "dolt-windows-amd64.zip",
        sha256: "d30afe7234317d18e72d0e9b761565b311ddd0ea76d5350a0c142edfe912625c",
        archiveType: "zip",
        executablePath: "dolt-windows-amd64/bin/dolt.exe",
      }),
    },
  },
] as const satisfies readonly ElectronExternalSidecarTarget[];

export const electronExternalSidecarAssetFileName = (
  asset: Pick<ElectronExternalSidecarAsset, "url">,
): string => basename(new URL(asset.url).pathname);

export const resolveElectronExternalSidecarTarget = ({
  arch,
  platform,
}: {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
}): ElectronExternalSidecarTarget => {
  const target = ELECTRON_EXTERNAL_SIDECAR_TARGETS.find(
    (entry) => entry.platform === platform && entry.arch === arch,
  );
  if (target) {
    return target;
  }

  throw new Error(`No pinned Electron sidecar target for ${platform}/${arch}.`);
};
