import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getHostArtifactName, resolveHostBinary } from "./artifact-resolver";

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

      expect(
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "arm64",
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
      writeFileSync(path.join(packageRoot, "bin", artifactName), "host-binary");

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "x64",
        }),
      ).toThrow("OpenDucktor web host checksum not found");
    } finally {
      cleanup(packageRoot);
    }
  });

  test("rejects packaged host artifacts with mismatched checksums", () => {
    const packageRoot = createTempPackageRoot();
    try {
      const artifactName = getHostArtifactName({ platform: "darwin", arch: "x64" });
      const binaryPath = path.join(packageRoot, "bin", artifactName);
      writeFileSync(binaryPath, "host-binary");
      writeFileSync(`${binaryPath}.sha256`, "deadbeef\n");

      expect(() =>
        resolveHostBinary({
          packageRoot,
          workspaceMode: false,
          platform: "darwin",
          arch: "x64",
        }),
      ).toThrow("OpenDucktor web host checksum mismatch");
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
});
