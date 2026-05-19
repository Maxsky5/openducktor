import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  resolvePackagedMcpSidecarPath,
  verifyPackagedMcpSidecar,
} from "./verify-mcp-sidecar-package";

const makeReleaseDirectory = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "openducktor-electron-package-sidecar-"));

const writePackagedSidecar = async ({
  contents = "binary",
  executable = true,
  platform,
  releaseDirectory,
}: {
  contents?: string;
  executable?: boolean;
  platform: "linux" | "windows";
  releaseDirectory: string;
}): Promise<string> => {
  const path = resolvePackagedMcpSidecarPath({ platform, releaseDirectory });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  if (platform === "linux") {
    await chmod(path, executable ? 0o755 : 0o644);
  }
  return path;
};

describe("verifyPackagedMcpSidecar", () => {
  test("resolves Electron Builder unpacked sidecar paths", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    expect(resolvePackagedMcpSidecarPath({ platform: "windows", releaseDirectory })).toBe(
      join(releaseDirectory, "win-unpacked", "resources", "bin", "openducktor-mcp.exe"),
    );
    expect(resolvePackagedMcpSidecarPath({ platform: "linux", releaseDirectory })).toBe(
      join(releaseDirectory, "linux-unpacked", "resources", "bin", "openducktor-mcp"),
    );
  });

  test("accepts a non-empty Windows sidecar without Unix executable-bit validation", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const sidecarPath = await writePackagedSidecar({
      platform: "windows",
      releaseDirectory,
    });

    await expect(verifyPackagedMcpSidecar({ platform: "windows", releaseDirectory })).resolves.toBe(
      sidecarPath,
    );
  });

  test("rejects a missing Windows sidecar at the expected package path", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await mkdir(join(releaseDirectory, "win-unpacked", "resources", "bin"), { recursive: true });
    await writeFile(
      join(releaseDirectory, "win-unpacked", "resources", "bin", "openducktor-mcp"),
      "wrong-name",
    );

    await expect(
      verifyPackagedMcpSidecar({ platform: "windows", releaseDirectory }),
    ).rejects.toThrow("openducktor-mcp.exe");
  });

  test("rejects an empty Windows sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedSidecar({
      contents: "",
      platform: "windows",
      releaseDirectory,
    });

    await expect(
      verifyPackagedMcpSidecar({ platform: "windows", releaseDirectory }),
    ).rejects.toThrow("expected a non-empty file");
  });

  test("accepts a non-empty executable Linux sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const sidecarPath = await writePackagedSidecar({
      platform: "linux",
      releaseDirectory,
    });

    await expect(verifyPackagedMcpSidecar({ platform: "linux", releaseDirectory })).resolves.toBe(
      sidecarPath,
    );
  });

  test("rejects an empty Linux sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedSidecar({
      contents: "",
      platform: "linux",
      releaseDirectory,
    });

    await expect(verifyPackagedMcpSidecar({ platform: "linux", releaseDirectory })).rejects.toThrow(
      "expected a non-empty file",
    );
  });

  test("rejects a non-executable Linux sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedSidecar({
      executable: false,
      platform: "linux",
      releaseDirectory,
    });

    await expect(verifyPackagedMcpSidecar({ platform: "linux", releaseDirectory })).rejects.toThrow(
      "expected an executable file",
    );
  });

  test("does not validate unrelated package platforms", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    await expect(verifyPackagedMcpSidecar({ platform: "macos", releaseDirectory })).resolves.toBe(
      undefined,
    );
  });
});
