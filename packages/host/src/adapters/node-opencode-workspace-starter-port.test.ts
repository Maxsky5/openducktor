import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { SystemCommandPort } from "../ports/system-command-port";
import {
  buildOpenCodeConfigContent,
  createNodeOpenCodeWorkspaceStarterPort,
} from "./node-opencode-workspace-starter-port";

const createSystemCommands = (): SystemCommandPort => ({
  async requiredCommandError() {
    return null;
  },
  async versionCommand() {
    return "opencode 1.0.0";
  },
  async runCommandAllowFailure() {
    return { ok: true, stdout: "", stderr: "" };
  },
});

const createFakeOpenCode = async (root: string): Promise<string> => {
  const executable = join(root, "opencode");
  await writeFile(
    executable,
    `#!/usr/bin/env bun
import { createServer } from "node:net";

const args = process.argv.slice(2);
if (args[0] !== "serve") {
  console.error("expected serve command");
  process.exit(2);
}
const portFlagIndex = args.indexOf("--port");
const port = Number(args[portFlagIndex + 1]);
const server = createServer((socket) => socket.end());
server.listen(port, "127.0.0.1");
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`,
  );
  await chmod(executable, 0o755);
  return executable;
};

describe("createNodeOpenCodeWorkspaceStarterPort", () => {
  test("builds OpenCode config content for the host bridge MCP", () => {
    expect(
      JSON.parse(
        buildOpenCodeConfigContent(
          {
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          },
          ["mcp-bin", "--stdio"],
        ),
      ),
    ).toEqual({
      logLevel: "INFO",
      mcp: {
        openducktor: {
          type: "local",
          enabled: true,
          command: ["mcp-bin", "--stdio"],
          environment: {
            ODT_WORKSPACE_ID: "repo",
            ODT_HOST_URL: "http://127.0.0.1:14327",
            ODT_HOST_TOKEN: "token-1",
            ODT_FORBID_WORKSPACE_ID_INPUT: "true",
          },
        },
      },
    });
  });

  test("fails fast when the MCP bridge connection is not configured", async () => {
    const starter = createNodeOpenCodeWorkspaceStarterPort({
      systemCommands: createSystemCommands(),
      mcpCommand: ["mcp-bin"],
    });

    await expect(
      starter.startWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      }),
    ).rejects.toThrow("OpenCode workspace startup requires an MCP host bridge connection.");
  });

  test("starts a reachable OpenCode workspace runtime and stops its process", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-opencode-starter-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const opencodeBinary = await createFakeOpenCode(root);
      const starter = createNodeOpenCodeWorkspaceStarterPort({
        systemCommands: createSystemCommands(),
        opencodeBinary,
        mcpCommand: ["mcp-bin"],
        resolveMcpBridgeConnection: async () => ({
          workspaceId: "repo",
          hostUrl: "http://127.0.0.1:14327",
          hostToken: "token-1",
        }),
        startupTimeoutMs: 2_000,
        retryDelayMs: 20,
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });

      const handle = await starter.startWorkspaceRuntime({
        runtimeKind: "opencode",
        repoPath: repo,
        workingDirectory: repo,
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      });

      expect(handle.runtime).toMatchObject({
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: repo,
        role: "workspace",
        workingDirectory: repo,
        runtimeRoute: {
          type: "local_http",
          endpoint: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        },
        startedAt: "2026-05-10T10:00:00.000Z",
      });

      await expect(handle.stop()).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
