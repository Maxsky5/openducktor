import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type HostArtifactPlatform = "darwin";
export type HostArtifactArch = "arm64" | "x64";

export type HostArtifactTarget = {
  platform: HostArtifactPlatform;
  arch: HostArtifactArch;
};

type VerifiedArtifactOptions = {
  label: string;
  path: string;
};

export type ResolvedHostBinary =
  | {
      kind: "workspace";
      command: string;
      args: string[];
      cwd: string;
    }
  | {
      kind: "artifact";
      path: string;
      mcpSidecarPath?: string;
    };

export type ResolveHostBinaryOptions = {
  packageRoot: string;
  workspaceRoot?: string;
  workspaceMode: boolean;
  explicitBinaryPath?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
};

const SUPPORTED_TARGETS = new Set(["darwin-arm64", "darwin-x64"]);

export const getHostArtifactName = (target: HostArtifactTarget): string => {
  return `openducktor-web-host-${target.platform}-${target.arch}`;
};

export const getMcpSidecarArtifactName = (target: HostArtifactTarget): string => {
  return `openducktor-mcp-${target.platform}-${target.arch}`;
};

const normalizeTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): HostArtifactTarget => {
  const key = `${platform}-${arch}`;
  if (!SUPPORTED_TARGETS.has(key)) {
    throw new Error(
      `@openducktor/web supports macOS arm64 and x64 for this release. Unsupported platform: ${platform}-${arch}.`,
    );
  }

  return { platform: "darwin", arch: arch as HostArtifactArch };
};

const assertExecutableFile = ({ label, path: binaryPath }: VerifiedArtifactOptions): void => {
  if (!existsSync(binaryPath)) {
    throw new Error(`${label} not found: ${binaryPath}`);
  }
  const stats = statSync(binaryPath);
  if (!stats.isFile()) {
    throw new Error(`${label} path is not a file: ${binaryPath}`);
  }
  if (process.platform !== "win32" && (stats.mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${binaryPath}`);
  }
};

const verifyChecksum = ({ label, path: binaryPath }: VerifiedArtifactOptions): void => {
  const checksumPath = `${binaryPath}.sha256`;
  if (!existsSync(checksumPath)) {
    throw new Error(`${label} checksum not found: ${checksumPath}`);
  }

  const expected = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
  if (!expected) {
    throw new Error(`${label} checksum file is empty: ${checksumPath}`);
  }

  const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${label} checksum mismatch for ${binaryPath}. Expected ${expected}, received ${actual}.`,
    );
  }
};

const verifyExecutableArtifact = (artifact: VerifiedArtifactOptions): void => {
  assertExecutableFile(artifact);
  verifyChecksum(artifact);
};

export const resolveHostBinary = (options: ResolveHostBinaryOptions): ResolvedHostBinary => {
  if (options.explicitBinaryPath) {
    const binaryPath = path.resolve(options.explicitBinaryPath);
    assertExecutableFile({ label: "OpenDucktor web host binary", path: binaryPath });
    return { kind: "artifact", path: binaryPath };
  }

  if (options.workspaceMode) {
    if (!options.workspaceRoot) {
      throw new Error("Workspace mode requires an explicit workspace root.");
    }

    return {
      kind: "workspace",
      command: "cargo",
      args: ["run", "--bin", "openducktor-web-host", "--"],
      cwd: path.join(options.workspaceRoot, "apps/desktop/src-tauri"),
    };
  }

  const target = normalizeTarget(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const binaryPath = path.join(options.packageRoot, "bin", getHostArtifactName(target));
  const mcpSidecarPath = path.join(options.packageRoot, "bin", getMcpSidecarArtifactName(target));
  verifyExecutableArtifact({ label: "OpenDucktor web host binary", path: binaryPath });
  verifyExecutableArtifact({ label: "OpenDucktor MCP sidecar", path: mcpSidecarPath });
  return { kind: "artifact", path: binaryPath, mcpSidecarPath };
};
