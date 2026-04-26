import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getHostArtifactName,
  getMcpSidecarArtifactName,
  resolveHostBinary,
} from "./artifact-resolver";

const createTempPackageRoot = (): string => {
  const root = path.join(
    os.tmpdir(),
    `openducktor-web-artifact-resolver-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  mkdirSync(path.join(root, "bin"), { recursive: true });
  return root;
};

const cleanup = (root: string): void => {
  rmSync(root, { recursive: true, force: true });
};

const writeArtifact = (packageRoot: string, name: string, contents: string): string => {
  const binaryPath = path.join(packageRoot, "bin", name);
  writeFileSync(binaryPath, contents);
  chmodSync(binaryPath, 0o755);
  const checksum = createHash("sha256").update(contents).digest("hex");
  writeFileSync(`${binaryPath}.sha256`, `${checksum}  ${name}\n`);
  return binaryPath;
};

describe("artifact resolver", () => {
  test("resolves workspace mode to the checked-out Rust host binary", () => {
    const resolved = resolveHostBinary({
      packageRoot: "/repo/packages/openducktor-web",
      workspaceRoot: "/repo",
      workspaceMode: true,
    });

    expect(resolved).toEqual({
      kind: "workspace",
      command: "cargo",
      args: ["run", "--bin", "openducktor-web-host", "--"],
      cwd: path.join("/repo", "apps/desktop/src-tauri"),
    });
  });

  test("rejects workspace mode without a workspace root", () => {
    expect(() =>
      resolveHostBinary({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
      }),
    ).toThrow("Workspace mode requires an explicit workspace root.");
  });

  test("resolves packaged macOS host artifacts after checksum verification", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "arm64" });
      const binaryPath = writeArtifact(packageRoot, artifactName, "host-binary");
      const mcpArtifactName = getMcpSidecarArtifactName({ platform: "darwin", arch: "arm64" });
      const mcpSidecarPath = writeArtifact(packageRoot, mcpArtifactName, "mcp-sidecar");

      expect(
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "arm64",
        }),
      ).toEqual({ kind: "artifact", path: binaryPath, mcpSidecarPath });
    } finally {
      cleanup(packageRoot);
    }
  });

  test("normalizes explicit host binary paths before spawning with a custom cwd", () => {
    const packageRoot = createTempPackageRoot();
    const previousCwd = process.cwd();
    try {
      const relativePackageRoot = path.relative(previousCwd, packageRoot);
      const binaryPath = writeArtifact(packageRoot, "explicit-host", "host-binary");
      const relativeBinaryPath = path.join(relativePackageRoot, "bin", "explicit-host");

      expect(
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          explicitBinaryPath: relativeBinaryPath,
        }),
      ).toEqual({ kind: "artifact", path: binaryPath });
    } finally {
      cleanup(packageRoot);
    }
  });

  test("rejects packaged host artifacts with missing checksums", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "x64" });
      const binaryPath = path.join(packageRoot, "bin", artifactName);
      writeFileSync(binaryPath, "host-binary");
      chmodSync(binaryPath, 0o755);
      const mcpArtifactName = getMcpSidecarArtifactName({ platform: "darwin", arch: "x64" });
      writeArtifact(packageRoot, mcpArtifactName, "mcp-sidecar");

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "x64",
        }),
      ).toThrow("OpenDucktor web host binary checksum not found");
    } finally {
      cleanup(packageRoot);
    }
  });

  test("rejects packaged host artifacts without the MCP sidecar", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "x64" });
      writeArtifact(packageRoot, artifactName, "host-binary");

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "x64",
        }),
      ).toThrow("OpenDucktor MCP sidecar not found");
    } finally {
      cleanup(packageRoot);
    }
  });

  test("rejects packaged MCP sidecars with mismatched checksums", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "x64" });
      writeArtifact(packageRoot, artifactName, "host-binary");
      const mcpArtifactName = getMcpSidecarArtifactName({ platform: "darwin", arch: "x64" });
      const mcpSidecarPath = path.join(packageRoot, "bin", mcpArtifactName);
      writeFileSync(mcpSidecarPath, "mcp-sidecar");
      chmodSync(mcpSidecarPath, 0o755);
      writeFileSync(`${mcpSidecarPath}.sha256`, "deadbeef\n");

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "x64",
        }),
      ).toThrow("OpenDucktor MCP sidecar checksum mismatch");
    } finally {
      cleanup(packageRoot);
    }
  });

  test("rejects unsupported packaged host platforms", () => {
    expect(() =>
      resolveHostBinary({
        packageRoot: "/tmp/openducktor-web",
        workspaceMode: false,
        platform: "linux",
        arch: "x64",
      }),
    ).toThrow("@openducktor/web supports macOS arm64 and x64");
  });

  test("rejects packaged host artifacts that are not executable", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "arm64" });
      const binaryPath = path.join(packageRoot, "bin", artifactName);
      writeFileSync(binaryPath, "host-binary");
      chmodSync(binaryPath, 0o644);
      const checksum = createHash("sha256").update("host-binary").digest("hex");
      writeFileSync(`${binaryPath}.sha256`, `${checksum}  ${artifactName}\n`);

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "arm64",
        }),
      ).toThrow("OpenDucktor web host binary is not executable");
    } finally {
      cleanup(packageRoot);
    }
  });
});
