import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
} from "../runtimes/runtime-distribution";
import { resolveOpenDucktorMcpCommand } from "./openducktor-mcp-command";

const testIfUnixModeIsAvailable = process.platform === "win32" ? test.skip : test;

const createSystemCommands = (bunAvailable = true): SystemCommandPort => ({
  requiredCommandError(command) {
    if (command === "bun" && bunAvailable) {
      return Effect.succeed(null);
    }
    return Effect.succeed(`Required command \`${command}\` not found.`);
  },
  versionCommand() {
    return Effect.succeed(null);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});
const createWorkspaceRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "odt-mcp-command-"));
  await mkdir(join(root, "apps"));
  await mkdir(join(root, "packages", "openducktor-mcp", "src"), { recursive: true });
  await writeFile(join(root, "bun.lock"), "");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "openducktor" }));
  await writeFile(join(root, "packages", "openducktor-mcp", "src", "index.ts"), "");
  return root;
};
const expectArtifactMcpCommandRejected = async (sidecar: string): Promise<void> => {
  await expect(
    Effect.runPromise(
      resolveOpenDucktorMcpCommand({
        systemCommands: createSystemCommands(),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: {
            kind: "executable",
            executablePath: sidecar,
          },
        }),
      }),
    ),
  ).rejects.toThrow(
    "Runtime artifact distribution MCP launcher points to a missing or non-executable file",
  );
};
describe("resolveOpenDucktorMcpCommand", () => {
  test("uses an executable MCP artifact launcher from the runtime distribution", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
    await chmod(sidecar, 0o755);
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "executable",
              executablePath: sidecar,
            },
          }),
        }),
      ),
    ).resolves.toEqual([sidecar]);
  });
  test("fails fast when the artifact MCP command is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");

    await expectArtifactMcpCommandRejected(sidecar);
  });
  test("fails fast when an artifact MCP command dependency is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-required-file-"));
    const bun = join(root, "bun");
    const mcpEntrypoint = join(root, "openducktor-mcp.js");
    await writeFile(bun, "#!/bin/sh\nexit 0\n");
    await chmod(bun, 0o755);

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "bunScript",
              bunExecutablePath: bun,
              scriptPath: mcpEntrypoint,
            },
          }),
        }),
      ),
    ).rejects.toThrow("Runtime artifact distribution MCP launcher requires a missing file");
  });
  test("uses a Bun script MCP artifact launcher from the runtime distribution", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-bun-script-"));
    const bun = join(root, "bun");
    const mcpEntrypoint = join(root, "openducktor-mcp.js");
    await writeFile(bun, "#!/bin/sh\nexit 0\n");
    await chmod(bun, 0o755);
    await writeFile(mcpEntrypoint, "#!/usr/bin/env bun\n");

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "bunScript",
              bunExecutablePath: bun,
              scriptPath: mcpEntrypoint,
            },
          }),
        }),
      ),
    ).resolves.toEqual([bun, mcpEntrypoint]);
  });
  testIfUnixModeIsAvailable(
    "fails fast when the artifact MCP command is not executable",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "odt-mcp-non-executable-sidecar-"));
      const sidecar = join(root, "openducktor-mcp");
      await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
      await chmod(sidecar, 0o644);

      await expectArtifactMcpCommandRejected(sidecar);
    },
  );
  test("fails fast when the artifact MCP command is a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-directory-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await mkdir(sidecar);
    await chmod(sidecar, 0o755);

    await expectArtifactMcpCommandRejected(sidecar);
  });
  test("resolves the workspace MCP entrypoint from a source runtime distribution", async () => {
    const root = await createWorkspaceRoot();
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          runtimeDistribution: createSourceRuntimeDistribution(root),
        }),
      ),
    ).resolves.toEqual(["bun", join(root, "packages", "openducktor-mcp", "src", "index.ts")]);
  });
  test("uses the artifact distribution as the MCP command source of truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-artifact-mode-"));
    const sidecar = join(root, "openducktor-mcp");
    await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
    await chmod(sidecar, 0o755);

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "executable",
              executablePath: sidecar,
            },
          }),
        }),
      ),
    ).resolves.toEqual([sidecar]);
  });
  test("fails fast when workspace execution is selected but bun is unavailable", async () => {
    const root = await createWorkspaceRoot();
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          runtimeDistribution: createSourceRuntimeDistribution(root),
        }),
      ),
    ).rejects.toThrow("OpenDucktor MCP workspace execution requires bun on PATH.");
  });
});
