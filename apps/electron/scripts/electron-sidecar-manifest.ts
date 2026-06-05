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

const BEADS_RELEASE_BASE_URL = "https://github.com/gastownhall/beads/releases/download/v1.0.4";
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
  version: "1.0.4",
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
        fileName: "beads_1.0.4_darwin_amd64.tar.gz",
        sha256: "8a52f7e54fe038d369cc9ea0e65f76853b75f5469c70c9c693d64671623c4ce9",
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
        fileName: "beads_1.0.4_darwin_arm64.tar.gz",
        sha256: "0c53479fea070a1cabe8eb31e3824d74c5643b1deca71a5fe832ebd38e9ef877",
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
        fileName: "beads_1.0.4_linux_amd64.tar.gz",
        sha256: "643e602e27f666c8726abff0f22001e2b5883988fa960204bde20a3129d448a5",
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
        fileName: "beads_1.0.4_linux_arm64.tar.gz",
        sha256: "48cdf571cd8b64bae81da829c1309e402bc12e6a4cc6b87606dfc9220b7ece60",
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
        fileName: "beads_1.0.4_windows_amd64.zip",
        sha256: "7bf67e6dc965813278ee651dff3a75f410f02f5b669ac295bb9e08d7bc7b39a3",
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
