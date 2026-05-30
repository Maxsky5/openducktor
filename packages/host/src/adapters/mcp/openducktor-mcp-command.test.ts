import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
} from "../runtimes/runtime-distribution";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import { resolveOpenDucktorMcpCommand } from "./openducktor-mcp-command";

const testIfUnixModeIsAvailable = process.platform === "win32" ? test.skip : test;

const createSystemCommands = (bunAvailable = true): SystemCommandPort => ({
  resolveCommandPath(command) {
    return Effect.succeed(command === "bun" && bunAvailable ? command : null);
  },
  versionCommand() {
    return Effect.succeed(null);
  },
  runCommandAllowFailure() {
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  },
});
const createToolDiscovery = (bunAvailable = true): ToolDiscoveryPort =>
  createToolDiscoveryAdapter({
    systemCommands: createSystemCommands(bunAvailable),
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
const expectArtifactMcpCommandRejected = async (
  sidecar: string,
  expectedMessage: string,
): Promise<void> => {
  await expect(
    Effect.runPromise(
      resolveOpenDucktorMcpCommand({
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: {
            kind: "executable",
            executablePath: sidecar,
          },
        }),
        toolDiscovery: createToolDiscovery(),
      }),
    ),
  ).rejects.toThrow(expectedMessage);
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
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "executable",
              executablePath: sidecar,
            },
          }),
          toolDiscovery: createToolDiscovery(false),
        }),
      ),
    ).resolves.toEqual([sidecar]);
  });
  test("fails fast when the artifact MCP command is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");

    await expectArtifactMcpCommandRejected(
      sidecar,
      "Runtime artifact distribution MCP launcher points to a missing file",
    );
  });
  test("validates an artifact MCP script before resolving its runner tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-required-file-"));
    const mcpEntrypoint = join(root, "openducktor-mcp.js");

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "toolScript",
              scriptPath: mcpEntrypoint,
              toolId: "bun",
            },
          }),
          toolDiscovery: createToolDiscovery(false),
        }),
      ),
    ).rejects.toThrow("Runtime artifact distribution MCP launcher requires a missing file");
  });
  test("fails fast when an artifact MCP command dependency is a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-directory-required-file-"));
    const mcpEntrypoint = join(root, "openducktor-mcp.js");
    await mkdir(mcpEntrypoint);

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "toolScript",
              scriptPath: mcpEntrypoint,
              toolId: "bun",
            },
          }),
          toolDiscovery: createToolDiscovery(),
        }),
      ),
    ).rejects.toThrow(
      "Runtime artifact distribution MCP launcher requires a regular file but received a directory",
    );
  });
  test("uses tool discovery for artifact script launchers", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-bun-script-"));
    const mcpEntrypoint = join(root, "openducktor-mcp.js");
    await writeFile(mcpEntrypoint, "#!/usr/bin/env bun\n");

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "toolScript",
              scriptPath: mcpEntrypoint,
              toolId: "bun",
            },
          }),
          toolDiscovery: {
            resolveToolPath: (toolId) => Effect.succeed(`/resolved/${toolId}`),
          },
        }),
      ),
    ).resolves.toEqual(["/resolved/bun", mcpEntrypoint]);
  });
  test("fails fast through tool discovery when an artifact script launcher tool is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-tool-script-"));
    const mcpEntrypoint = join(root, "openducktor-mcp.js");
    await writeFile(mcpEntrypoint, "#!/usr/bin/env bun\n");

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: {
              kind: "toolScript",
              scriptPath: mcpEntrypoint,
              toolId: "bun",
            },
          }),
          toolDiscovery: createToolDiscovery(false),
        }),
      ),
    ).rejects.toThrow("bun not found");
  });
  testIfUnixModeIsAvailable(
    "fails fast when the artifact MCP command is not executable",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "odt-mcp-non-executable-sidecar-"));
      const sidecar = join(root, "openducktor-mcp");
      await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
      await chmod(sidecar, 0o644);

      await expectArtifactMcpCommandRejected(
        sidecar,
        "Runtime artifact distribution MCP launcher points to a non-executable file",
      );
    },
  );
  test("fails fast when the artifact MCP command is a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-directory-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await mkdir(sidecar);
    await chmod(sidecar, 0o755);

    await expectArtifactMcpCommandRejected(
      sidecar,
      "Runtime artifact distribution MCP launcher points to a directory, not an executable file",
    );
  });
  test("resolves the workspace MCP entrypoint from a source runtime distribution", async () => {
    const root = await createWorkspaceRoot();
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createSourceRuntimeDistribution(root),
          toolDiscovery: createToolDiscovery(),
        }),
      ),
    ).resolves.toEqual(["bun", join(root, "packages", "openducktor-mcp", "src", "index.ts")]);
  });
  test("fails fast when workspace execution is selected but bun is unavailable", async () => {
    const root = await createWorkspaceRoot();
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createSourceRuntimeDistribution(root),
          toolDiscovery: createToolDiscovery(false),
        }),
      ),
    ).rejects.toThrow("OpenDucktor MCP workspace execution requires bun.");
  });
  test("preserves validation errors from Bun discovery", async () => {
    const root = await createWorkspaceRoot();
    const result = await Effect.runPromise(
      Effect.either(
        resolveOpenDucktorMcpCommand({
          runtimeDistribution: createSourceRuntimeDistribution(root),
          toolDiscovery: {
            resolveToolPath: () =>
              Effect.fail(
                new HostValidationError({
                  field: "OPENDUCKTOR_BUN_PATH",
                  message: "Configured bun override is invalid.",
                }),
              ),
          },
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") {
      return;
    }
    expect(result.left).toBeInstanceOf(HostValidationError);
    expect(result.left.message).toBe("Configured bun override is invalid.");
  });
});
