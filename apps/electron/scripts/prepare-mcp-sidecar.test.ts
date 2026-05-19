import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mcpSidecarExecutableName,
  prepareMcpSidecar,
  resolveMcpSidecarBuildPlan,
} from "./prepare-mcp-sidecar";

const makeTempWorkspace = async (): Promise<{
  electronPackageDirectory: string;
  workspaceRoot: string;
}> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "openducktor-electron-sidecar-"));
  const electronPackageDirectory = join(workspaceRoot, "apps", "electron");
  const mcpSourceDirectory = join(workspaceRoot, "packages", "openducktor-mcp", "src");

  await mkdir(electronPackageDirectory, { recursive: true });
  await mkdir(mcpSourceDirectory, { recursive: true });
  await writeFile(join(mcpSourceDirectory, "index.ts"), "console.log('mcp');\n");

  return { electronPackageDirectory, workspaceRoot };
};

describe("prepareMcpSidecar", () => {
  test("uses a platform-specific executable name", () => {
    expect(mcpSidecarExecutableName("darwin")).toBe("openducktor-mcp");
    expect(mcpSidecarExecutableName("linux")).toBe("openducktor-mcp");
    expect(mcpSidecarExecutableName("win32")).toBe("openducktor-mcp.exe");
  });

  test("stages the sidecar under the Electron package build directory", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();

    expect(
      resolveMcpSidecarBuildPlan({
        electronPackageDirectory,
        platform: "darwin",
        workspaceRoot,
      }),
    ).toMatchObject({
      entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
      outputDirectory: join(electronPackageDirectory, "build", "sidecars"),
      outputPath: join(electronPackageDirectory, "build", "sidecars", "openducktor-mcp"),
      workspaceRoot,
    });
  });

  test("cleans, compiles, and marks the Linux sidecar executable", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const chmodCalls: Array<{ mode: number; path: string }> = [];
    await mkdir(join(electronPackageDirectory, "build", "sidecars"), { recursive: true });
    await writeFile(staleOutput, "stale");

    const plan = await prepareMcpSidecar({
      electronPackageDirectory,
      platform: "linux",
      workspaceRoot,
      compile: async ({ outputPath }) => {
        await writeFile(outputPath, "#!/bin/sh\nexit 0\n");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
      },
    });

    await expect(stat(staleOutput)).rejects.toThrow();
    const metadata = await stat(plan.outputPath);
    expect(metadata.isFile()).toBe(true);
    expect(chmodCalls).toEqual([{ mode: 0o755, path: plan.outputPath }]);
  });

  test("does not chmod Windows sidecars", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const chmodCalls: Array<{ mode: number; path: string }> = [];

    await prepareMcpSidecar({
      electronPackageDirectory,
      platform: "win32",
      workspaceRoot,
      compile: async ({ outputPath }) => {
        await writeFile(outputPath, "binary");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
      },
    });

    expect(chmodCalls).toEqual([]);
  });
});
