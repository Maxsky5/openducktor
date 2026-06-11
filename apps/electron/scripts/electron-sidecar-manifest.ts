import type { ElectronReleasePlatform } from "./electron-release-targets";

export const ELECTRON_SIDECAR_IDS = ["openducktor-mcp"] as const;
export type ElectronSidecarId = (typeof ELECTRON_SIDECAR_IDS)[number];

export const electronSidecarExecutableName = (
  sidecarId: ElectronSidecarId,
  platform: ElectronReleasePlatform,
): string => {
  const executableSuffix = platform === "windows" ? ".exe" : "";

  switch (sidecarId) {
    case "openducktor-mcp":
      return `openducktor-mcp${executableSuffix}`;
  }
};

export const electronSidecarDisplayName = (sidecarId: ElectronSidecarId): string => {
  switch (sidecarId) {
    case "openducktor-mcp":
      return "OpenDucktor MCP";
  }
};
