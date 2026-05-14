import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { parseMcpCommandJson, resolveOpenDucktorMcpCommand } from "./openducktor-mcp-command";

const createSystemCommands = (bunAvailable = true): SystemCommandPort => ({
  async requiredCommandError(command) {
    if (command === "bun" && bunAvailable) {
      return null;
    }
    return `Required command \`${command}\` not found.`;
  },
  async versionCommand() {
    return null;
  },
  async runCommandAllowFailure() {
    return { ok: true, stdout: "", stderr: "" };
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

describe("resolveOpenDucktorMcpCommand", () => {
  test("parses explicit command JSON", () => {
    expect(parseMcpCommandJson('["  mcp-bin  "," --stdio "]')).toEqual(["mcp-bin", "--stdio"]);
    expect(() => parseMcpCommandJson('["mcp-bin",""]')).toThrow(
      "OPENDUCKTOR_MCP_COMMAND_JSON must contain only non-empty strings.",
    );
  });

  test("uses explicit command JSON before other resolution", async () => {
    await expect(
      resolveOpenDucktorMcpCommand({
        systemCommands: createSystemCommands(false),
        env: {
          OPENDUCKTOR_MCP_COMMAND_JSON: '["mcp-bin","--stdio"]',
        },
        startPath: "/missing",
      }),
    ).resolves.toEqual(["mcp-bin", "--stdio"]);
  });

  test("uses an explicit executable MCP sidecar path", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
    await chmod(sidecar, 0o755);

    await expect(
      resolveOpenDucktorMcpCommand({
        systemCommands: createSystemCommands(false),
        env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: sidecar },
        startPath: "/missing",
      }),
    ).resolves.toEqual([sidecar]);
  });

  test("resolves the workspace MCP entrypoint from an ancestor directory", async () => {
    const root = await createWorkspaceRoot();
    const nested = join(root, "apps", "electron");
    await mkdir(nested, { recursive: true });

    await expect(
      resolveOpenDucktorMcpCommand({
        systemCommands: createSystemCommands(),
        env: {},
        startPath: nested,
      }),
    ).resolves.toEqual(["bun", join(root, "packages", "openducktor-mcp", "src", "index.ts")]);
  });

  test("fails fast when workspace execution is selected but bun is unavailable", async () => {
    const root = await createWorkspaceRoot();

    await expect(
      resolveOpenDucktorMcpCommand({
        systemCommands: createSystemCommands(false),
        env: { OPENDUCKTOR_WORKSPACE_ROOT: root },
        startPath: "/missing",
      }),
    ).rejects.toThrow("OpenDucktor MCP workspace execution requires bun on PATH.");
  });
});
