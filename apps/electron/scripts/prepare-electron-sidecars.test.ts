import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveHostReleaseArch, resolveHostReleasePlatform } from "./electron-release-targets";
import { electronSidecarExecutableName } from "./electron-sidecar-manifest";
import {
  prepareElectronSidecars,
  resolveElectronSidecarBuildPlan,
} from "./prepare-electron-sidecars";

type PrepareElectronSidecarsHooks = Pick<
  Parameters<typeof prepareElectronSidecars>[0],
  "chmodFile" | "compileMcp"
>;

const hostPlatform = resolveHostReleasePlatform(process.platform);
const hostArch = resolveHostReleaseArch(process.arch);

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
        arch: "arm64",
        electronPackageDirectory,
        platform: "macos",
        workspaceRoot,
      }),
    ).toEqual({
      compileCommand: [
        "bun",
        "build",
        "--compile",
        "--target=bun-darwin-arm64",
        "--outfile",
        join(electronPackageDirectory, "build", "sidecars", "openducktor-mcp"),
        join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
      ],
      entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
      outputDirectory: join(electronPackageDirectory, "build", "sidecars"),
      outputPaths: {
        "openducktor-mcp": join(electronPackageDirectory, "build", "sidecars", "openducktor-mcp"),
      },
      workspaceRoot,
    });
  });

  test.each([
    ["linux", "arm64", "bun-linux-arm64"],
    ["linux", "x64", "bun-linux-x64"],
    ["macos", "arm64", "bun-darwin-arm64"],
    ["macos", "x64", "bun-darwin-x64"],
    ["windows", "arm64", "bun-windows-arm64"],
    ["windows", "x64", "bun-windows-x64"],
  ] as const)("passes %s %s to the Bun compile command", (platform, arch, target) => {
    const plan = resolveElectronSidecarBuildPlan({
      arch,
      electronPackageDirectory: "/electron",
      platform,
      workspaceRoot: "/workspace",
    });
    expect(plan.compileCommand).toContain(`--target=${target}`);
    expect(plan.compileCommand.at(-1)).toBe(plan.entrypoint);
    expect(plan.compileCommand.at(-2)).toBe(plan.outputPaths["openducktor-mcp"]);
  });

  test("cleans and compiles the MCP sidecar for the host", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const chmodCalls: Array<{ mode: number; path: string }> = [];
    await mkdir(join(electronPackageDirectory, "build", "sidecars"), { recursive: true });
    await writeFile(staleOutput, "stale");

    const prepared = await prepareElectronSidecars({
      arch: hostArch,
      electronPackageDirectory,
      platform: hostPlatform,
      workspaceRoot,
      compileMcp: async ({ compileCommand, outputPaths }) => {
        expect(compileCommand).toContain(
          `--target=bun-${hostPlatform === "macos" ? "darwin" : hostPlatform}-${hostArch}`,
        );
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
    expect(chmodCalls).toEqual(
      hostPlatform === "windows"
        ? []
        : [{ mode: 0o755, path: prepared.plan.outputPaths["openducktor-mcp"] }],
    );
  }, 5_000);

  test("rejects a missing MCP entrypoint before mutating sidecar output", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const mcpEntrypoint = join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts");
    const sideEffects: string[] = [];
    await mkdir(dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale");
    await rm(mcpEntrypoint);

    const error = await prepareElectronSidecars({
      arch: hostArch,
      electronPackageDirectory,
      platform: hostPlatform,
      workspaceRoot,
      ...makeSideEffectingHooks(sideEffects),
    }).catch((cause: unknown): Error =>
      cause instanceof Error ? cause : new Error(String(cause), { cause }),
    );

    expect(error).toMatchObject({
      _tag: "ElectronValidationError",
      operation: "electron.sidecar.assert-file-exists",
      path: mcpEntrypoint,
    });
    if (!(error instanceof Error)) {
      throw new TypeError("Expected an Error instance.");
    }
    expect(error.message).toContain("OpenDucktor MCP entrypoint is missing");
    expect(sideEffects).toEqual([]);
    await expect(stat(staleOutput)).resolves.toMatchObject({ size: 5 });
  });

  test("rejects a different host architecture before cleaning sidecar output", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const sideEffects: string[] = [];
    await mkdir(dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale");

    const error = await prepareElectronSidecars({
      arch: hostArch === "x64" ? "arm64" : "x64",
      electronPackageDirectory,
      platform: hostPlatform,
      workspaceRoot,
      ...makeSideEffectingHooks(sideEffects),
    }).catch((cause: unknown): Error =>
      cause instanceof Error ? cause : new Error(String(cause), { cause }),
    );

    expect(error).toMatchObject({ operation: "electron.release-target.assert-matching-host" });
    expect(sideEffects).toEqual([]);
    await expect(stat(staleOutput)).resolves.toMatchObject({ size: 5 });
  });

  test.skipIf(process.platform !== "win32")("does not chmod Windows MCP sidecar", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const chmodCalls: Array<{ mode: number; path: string }> = [];

    await prepareElectronSidecars({
      arch: hostArch,
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
