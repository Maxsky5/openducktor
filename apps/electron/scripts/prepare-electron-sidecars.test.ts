import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { electronSidecarExecutableName } from "./electron-sidecar-manifest";
import {
  prepareElectronSidecars,
  resolveElectronSidecarBuildPlan,
} from "./prepare-electron-sidecars";

type PrepareElectronSidecarsHooks = Pick<
  Parameters<typeof prepareElectronSidecars>[0],
  "chmodFile" | "compileMcp"
>;

const makeTempWorkspace = async (): Promise<{
  electronPackageDirectory: string;
  workspaceRoot: string;
}> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "openducktor-electron-sidecars-"));
  const electronPackageDirectory = join(workspaceRoot, "apps", "electron");
  const mcpSourceDirectory = join(workspaceRoot, "packages", "openducktor-mcp", "src");

  await mkdir(electronPackageDirectory, { recursive: true });
  await mkdir(mcpSourceDirectory, { recursive: true });
  await writeFile(join(mcpSourceDirectory, "index.ts"), "console.log('mcp');\n");

  return { electronPackageDirectory, workspaceRoot };
};

const makeSideEffectingHooks = (sideEffects: string[]): PrepareElectronSidecarsHooks => ({
  compileMcp: async ({ outputPaths }) => {
    sideEffects.push("compile");
    await writeFile(outputPaths["openducktor-mcp"], "binary");
  },
  chmodFile: async (path, mode) => {
    sideEffects.push("chmod");
    await chmod(path, mode);
  },
});

describe("prepareElectronSidecars", () => {
  test("uses platform-specific MCP executable names", () => {
    expect(electronSidecarExecutableName("openducktor-mcp", "macos")).toBe("openducktor-mcp");
    expect(electronSidecarExecutableName("openducktor-mcp", "windows")).toBe("openducktor-mcp.exe");
  });

  test("stages the MCP sidecar under the Electron package build directory", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();

    expect(
      resolveElectronSidecarBuildPlan({
        electronPackageDirectory,
        platform: "macos",
        workspaceRoot,
      }),
    ).toEqual({
      entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
      outputDirectory: join(electronPackageDirectory, "build", "sidecars"),
      outputPaths: {
        "openducktor-mcp": join(electronPackageDirectory, "build", "sidecars", "openducktor-mcp"),
      },
      workspaceRoot,
    });
  });

  test("cleans, compiles, and marks Linux MCP sidecar executable", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const chmodCalls: Array<{ mode: number; path: string }> = [];
    await mkdir(join(electronPackageDirectory, "build", "sidecars"), { recursive: true });
    await writeFile(staleOutput, "stale");

    const prepared = await prepareElectronSidecars({
      arch: "x64",
      electronPackageDirectory,
      platform: "linux",
      workspaceRoot,
      compileMcp: async ({ outputPaths }) => {
        await writeFile(outputPaths["openducktor-mcp"], "#!/bin/sh\nexit 0\n");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
        await chmod(path, mode);
      },
    });

    await expect(stat(staleOutput)).rejects.toThrow();
    expect(prepared.sidecars.map((sidecar) => sidecar.id)).toEqual(["openducktor-mcp"]);
    await expect(stat(prepared.plan.outputPaths["openducktor-mcp"])).resolves.toMatchObject({
      size: 17,
    });
    expect(chmodCalls).toEqual([
      {
        mode: 0o755,
        path: prepared.plan.outputPaths["openducktor-mcp"],
      },
    ]);
  });

  test("rejects a missing MCP entrypoint before mutating sidecar output", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const mcpEntrypoint = join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts");
    const sideEffects: string[] = [];
    await mkdir(dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale");
    await rm(mcpEntrypoint);

    await expect(
      prepareElectronSidecars({
        arch: "x64",
        electronPackageDirectory,
        platform: "linux",
        workspaceRoot,
        ...makeSideEffectingHooks(sideEffects),
      }),
    ).rejects.toThrow("OpenDucktor MCP entrypoint is missing");
    expect(sideEffects).toEqual([]);
    await expect(stat(staleOutput)).resolves.toMatchObject({ size: 5 });
  });

  test("does not chmod Windows MCP sidecar", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const chmodCalls: Array<{ mode: number; path: string }> = [];

    await prepareElectronSidecars({
      arch: "x64",
      electronPackageDirectory,
      platform: "windows",
      workspaceRoot,
      compileMcp: async ({ outputPaths }) => {
        await writeFile(outputPaths["openducktor-mcp"], "binary");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
      },
    });

    expect(chmodCalls).toEqual([]);
  });
});
