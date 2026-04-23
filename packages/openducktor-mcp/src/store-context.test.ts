import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { resolveStoreContext } from "./store-context";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

const createDiscoveryRegistry = async (ports: number[]): Promise<string> => {
  const dir = join(tmpdir(), `openducktor-mcp-store-context-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "runtime"), { recursive: true });
  await writeFile(
    join(dir, "runtime", "mcp-bridge-ports.json"),
    JSON.stringify({ ports }, null, 2),
    "utf8",
  );
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.ODT_WORKSPACE_ID;
  delete process.env.ODT_HOST_URL;
  delete process.env.ODT_METADATA_NAMESPACE;
  delete process.env.OPENDUCKTOR_CONFIG_DIR;
  delete process.env.ODT_BEADS_ATTACHMENT_DIR;
  delete process.env.ODT_DOLT_HOST;
  delete process.env.ODT_DOLT_PORT;
  delete process.env.ODT_DATABASE_NAME;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveStoreContext", () => {
  test("validates an explicit host bridge override before startup", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
    });
  });

  test("starts without a workspace default when the host bridge is healthy", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostUrl: "http://127.0.0.1:14327",
    });
  });

  test("rejects legacy direct Beads/Dolt startup contract", async () => {
    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_DOLT_HOST = "127.0.0.1";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "Direct Beads/Dolt MCP startup is no longer supported",
    );
  });

  test("fails fast when the host health check fails", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse(
          { error: "host down" },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).rejects.toThrow("host down");
  });

  test("discovers a running host from the registry when no explicit host is provided", async () => {
    const configDir = await createDiscoveryRegistry([14327]);
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:14327/health") {
        return jsonResponse({ ok: true });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_mcp_ready") {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_get_workspaces") {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
    });
  });

  test("tries discovered ports until one host becomes ready", async () => {
    const configDir = await createDiscoveryRegistry([14327, 14328]);
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:14327/health") {
        return jsonResponse(
          { error: "stale bridge" },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      if (url === "http://127.0.0.1:14328/health") {
        return jsonResponse({ ok: true });
      }
      if (url === "http://127.0.0.1:14328/invoke/odt_mcp_ready") {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url === "http://127.0.0.1:14328/invoke/odt_get_workspaces") {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14328",
    });
  });

  test("skips healthy discovered hosts that do not contain the configured workspace", async () => {
    const configDir = await createDiscoveryRegistry([14327, 14328]);
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:14327/health" || url === "http://127.0.0.1:14328/health") {
        return jsonResponse({ ok: true });
      }
      if (
        url === "http://127.0.0.1:14327/invoke/odt_mcp_ready" ||
        url === "http://127.0.0.1:14328/invoke/odt_mcp_ready"
      ) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_get_workspaces") {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "other-repo",
              workspaceName: "Other Repo",
              repoPath: "/other-repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      if (url === "http://127.0.0.1:14328/invoke/odt_get_workspaces") {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14328",
    });
  });

  test("rejects legacy metadata namespace configuration", async () => {
    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_METADATA_NAMESPACE = "legacy-namespace";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "Metadata namespace is now owned by the Rust host",
    );
  });

  test("fails clearly when discovery cannot find any running host", async () => {
    const configDir = await createDiscoveryRegistry([]);
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "No running OpenDucktor host was discovered",
    );
  });

  test("fails fast when the configured default workspace does not exist", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/invoke/odt_mcp_ready")) {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url.endsWith("/invoke/odt_get_workspaces")) {
        return jsonResponse({
          workspaces: [
            {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              isActive: true,
              hasConfig: true,
              configuredWorktreeBasePath: null,
              defaultWorktreeBasePath: null,
              effectiveWorktreeBasePath: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_WORKSPACE_ID = "missing-repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "Configured default workspace 'missing-repo' was not found",
    );
  });
});
