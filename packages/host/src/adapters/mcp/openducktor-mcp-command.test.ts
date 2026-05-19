import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../ports/system-command-port";
import { parseMcpCommandJson, resolveOpenDucktorMcpCommand } from "./openducktor-mcp-command";

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
describe("resolveOpenDucktorMcpCommand", () => {
  test("parses explicit command JSON", () => {
    expect(parseMcpCommandJson('["  mcp-bin  "," --stdio "]')).toEqual(["mcp-bin", "--stdio"]);
    expect(() => parseMcpCommandJson('["mcp-bin",""]')).toThrow(
      "OPENDUCKTOR_MCP_COMMAND_JSON must contain only non-empty strings.",
    );
  });
  test("uses explicit command JSON before other resolution", async () => {
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          env: {
            OPENDUCKTOR_MCP_COMMAND_JSON: '["mcp-bin","--stdio"]',
          },
          startPath: "/missing",
        }),
      ),
    ).resolves.toEqual(["mcp-bin", "--stdio"]);
  });
  test("uses an explicit executable MCP sidecar path", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
    await chmod(sidecar, 0o755);
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: sidecar },
          startPath: "/missing",
        }),
      ),
    ).resolves.toEqual([sidecar]);
  });
  test("fails fast when the explicit MCP sidecar path is empty", async () => {
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: "   " },
          startPath: "/missing",
        }),
      ),
    ).rejects.toThrow("OPENDUCKTOR_OPENDUCKTOR_MCP_PATH is set but empty.");
  });
  test("fails fast when the explicit MCP sidecar path is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-missing-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: sidecar },
          startPath: "/missing",
        }),
      ),
    ).rejects.toThrow("points to a missing or non-executable file");
  });
  test("fails fast when the explicit MCP sidecar path is not executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-non-executable-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await writeFile(sidecar, "#!/bin/sh\nexit 0\n");
    await chmod(sidecar, 0o644);

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: sidecar },
          startPath: "/missing",
        }),
      ),
    ).rejects.toThrow("points to a missing or non-executable file");
  });
  test("fails fast when the explicit MCP sidecar path is a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-mcp-directory-sidecar-"));
    const sidecar = join(root, "openducktor-mcp");
    await mkdir(sidecar);
    await chmod(sidecar, 0o755);

    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          env: { OPENDUCKTOR_OPENDUCKTOR_MCP_PATH: sidecar },
          startPath: "/missing",
        }),
      ),
    ).rejects.toThrow("points to a missing or non-executable file");
  });
  test("resolves the workspace MCP entrypoint from an ancestor directory", async () => {
    const root = await createWorkspaceRoot();
    const nested = join(root, "apps", "electron");
    await mkdir(nested, { recursive: true });
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(),
          env: {},
          startPath: nested,
        }),
      ),
    ).resolves.toEqual(["bun", join(root, "packages", "openducktor-mcp", "src", "index.ts")]);
  });
  test("fails fast when workspace execution is selected but bun is unavailable", async () => {
    const root = await createWorkspaceRoot();
    await expect(
      Effect.runPromise(
        resolveOpenDucktorMcpCommand({
          systemCommands: createSystemCommands(false),
          env: { OPENDUCKTOR_WORKSPACE_ROOT: root },
          startPath: "/missing",
        }),
      ),
    ).rejects.toThrow("OpenDucktor MCP workspace execution requires bun on PATH.");
  });
});
