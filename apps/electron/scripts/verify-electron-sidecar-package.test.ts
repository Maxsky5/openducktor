import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ElectronSidecarId } from "./electron-sidecar-manifest";
import {
  resolvePackagedElectronSidecarPath,
  type VerifiedPackagedElectronSidecar,
  verifyPackagedElectronSidecars,
} from "./verify-electron-sidecar-package";

const testIfUnixModeIsAvailable = process.platform === "win32" ? test.skip : test;
const releaseDirectories = new Set<string>();

const makeReleaseDirectory = async (): Promise<string> => {
  const releaseDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-package-sidecars-"));
  releaseDirectories.add(releaseDirectory);
  return releaseDirectory;
};

const REQUIRED_SIDECAR_IDS = ["openducktor-mcp", "beads", "dolt"] as const;

afterEach(async () => {
  await Promise.all(
    Array.from(releaseDirectories, (releaseDirectory) =>
      rm(releaseDirectory, { force: true, recursive: true }),
    ),
  );
  releaseDirectories.clear();
});

const writePackagedSidecar = async ({
  arch = "x64",
  contents = "binary",
  executable = true,
  platform,
  releaseDirectory,
  sidecarId,
}: {
  arch?: "arm64" | "x64";
  contents?: string;
  executable?: boolean;
  platform: "linux" | "windows";
  releaseDirectory: string;
  sidecarId: ElectronSidecarId;
}): Promise<string> => {
  const path = resolvePackagedElectronSidecarPath({
    arch,
    platform,
    releaseDirectory,
    sidecarId,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  if (platform === "linux") {
    await chmod(path, executable ? 0o755 : 0o644);
  }
  return path;
};

const writeRequiredPackagedSidecars = async ({
  arch = "x64",
  executable = true,
  platform,
  releaseDirectory,
}: {
  arch?: "arm64" | "x64";
  executable?: boolean;
  platform: "linux" | "windows";
  releaseDirectory: string;
}): Promise<VerifiedPackagedElectronSidecar[]> =>
  Promise.all(
    REQUIRED_SIDECAR_IDS.map(async (sidecarId) => ({
      id: sidecarId,
      path: await writePackagedSidecar({
        arch,
        executable,
        platform,
        releaseDirectory,
        sidecarId,
      }),
    })),
  );

describe("verifyPackagedElectronSidecars", () => {
  test("resolves Electron Builder unpacked sidecar paths", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    expect(
      resolvePackagedElectronSidecarPath({
        arch: "x64",
        platform: "windows",
        releaseDirectory,
        sidecarId: "beads",
      }),
    ).toBe(join(releaseDirectory, "win-unpacked", "resources", "bin", "bd.exe"));
    expect(
      resolvePackagedElectronSidecarPath({
        arch: "arm64",
        platform: "windows",
        releaseDirectory,
        sidecarId: "dolt",
      }),
    ).toBe(join(releaseDirectory, "win-arm64-unpacked", "resources", "bin", "dolt.exe"));
    expect(
      resolvePackagedElectronSidecarPath({
        arch: "x64",
        platform: "linux",
        releaseDirectory,
        sidecarId: "openducktor-mcp",
      }),
    ).toBe(join(releaseDirectory, "linux-unpacked", "resources", "bin", "openducktor-mcp"));
    expect(
      resolvePackagedElectronSidecarPath({
        arch: "arm64",
        platform: "linux",
        releaseDirectory,
        sidecarId: "beads",
      }),
    ).toBe(join(releaseDirectory, "linux-arm64-unpacked", "resources", "bin", "bd"));
  });

  test("accepts non-empty Windows sidecars without Unix executable-bit validation", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const sidecarPaths = await writeRequiredPackagedSidecars({
      platform: "windows",
      releaseDirectory,
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "windows", releaseDirectory }),
    ).resolves.toEqual(sidecarPaths);
  });

  test("accepts architecture-specific Windows and Linux sidecar package paths", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const windowsSidecarPaths = await writeRequiredPackagedSidecars({
      arch: "arm64",
      platform: "windows",
      releaseDirectory,
    });
    const linuxSidecarPaths = await writeRequiredPackagedSidecars({
      arch: "arm64",
      platform: "linux",
      releaseDirectory,
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "arm64", platform: "windows", releaseDirectory }),
    ).resolves.toEqual(windowsSidecarPaths);
    await expect(
      verifyPackagedElectronSidecars({ arch: "arm64", platform: "linux", releaseDirectory }),
    ).resolves.toEqual(linuxSidecarPaths);
  });

  test("rejects a missing required Windows sidecar at the expected package path", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writePackagedSidecar({
      platform: "windows",
      releaseDirectory,
      sidecarId: "openducktor-mcp",
    });
    await writePackagedSidecar({
      platform: "windows",
      releaseDirectory,
      sidecarId: "dolt",
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "windows", releaseDirectory }),
    ).rejects.toThrow("bd.exe");
  });

  test("rejects an empty required Windows sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writeRequiredPackagedSidecars({
      platform: "windows",
      releaseDirectory,
    });
    await writePackagedSidecar({
      contents: "",
      platform: "windows",
      releaseDirectory,
      sidecarId: "dolt",
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "windows", releaseDirectory }),
    ).rejects.toThrow("expected a non-empty file");
  });

  test("accepts non-empty executable Linux sidecars", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    const sidecarPaths = await writeRequiredPackagedSidecars({
      platform: "linux",
      releaseDirectory,
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "linux", releaseDirectory }),
    ).resolves.toEqual(sidecarPaths);
  });

  test("rejects an empty required Linux sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writeRequiredPackagedSidecars({
      platform: "linux",
      releaseDirectory,
    });
    await writePackagedSidecar({
      contents: "",
      platform: "linux",
      releaseDirectory,
      sidecarId: "beads",
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "linux", releaseDirectory }),
    ).rejects.toThrow("expected a non-empty file");
  });

  testIfUnixModeIsAvailable("rejects a non-executable required Linux sidecar", async () => {
    const releaseDirectory = await makeReleaseDirectory();
    await writeRequiredPackagedSidecars({
      platform: "linux",
      releaseDirectory,
    });
    await writePackagedSidecar({
      executable: false,
      platform: "linux",
      releaseDirectory,
      sidecarId: "dolt",
    });

    await expect(
      verifyPackagedElectronSidecars({ arch: "x64", platform: "linux", releaseDirectory }),
    ).rejects.toThrow("expected an executable file");
  });

  test("does not validate macOS unpacked package paths", async () => {
    const releaseDirectory = await makeReleaseDirectory();

    await expect(
      verifyPackagedElectronSidecars({ arch: "arm64", platform: "macos", releaseDirectory }),
    ).resolves.toEqual([]);
  });
});
