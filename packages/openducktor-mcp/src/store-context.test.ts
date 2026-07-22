import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { resolveStoreContext } from "./store-context";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];
const STORE_CONTEXT_ENV_KEYS = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "OPENDUCKTOR_CHANNEL",
  "OPENDUCKTOR_CONFIG_DIR",
] as const;
type StoreContextEnvKey = (typeof STORE_CONTEXT_ENV_KEYS)[number];
type StoreContextEnvSnapshot = Record<StoreContextEnvKey, string | undefined>;
let previousStoreContextEnv: StoreContextEnvSnapshot;

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

const createDiscoveryFile = async ({
  hostToken = "discovery-token",
  hostUrl = "http://127.0.0.1:14327",
  pid = 12345,
}: {
  hostToken?: string;
  hostUrl?: string;
  pid?: number;
} = {}): Promise<string> => {
  const dir = join(tmpdir(), `openducktor-mcp-store-context-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "runtime"), { recursive: true });
  await writeFile(
    join(dir, "runtime", "mcp-bridge.json"),
    JSON.stringify({ hostToken, hostUrl, pid }, null, 2),
    "utf8",
  );
  tempDirs.push(dir);
  return dir;
};

const createEmptyConfigDir = async (): Promise<string> => {
  const dir = join(tmpdir(), `openducktor-mcp-store-context-${Date.now()}-${Math.random()}`);
  await mkdir(join(dir, "runtime"), { recursive: true });
  tempDirs.push(dir);
  return dir;
};

const clearStoreContextEnv = (): void => {
  for (const key of STORE_CONTEXT_ENV_KEYS) {
    delete process.env[key];
  }
};

const snapshotStoreContextEnv = (): StoreContextEnvSnapshot =>
  Object.fromEntries(
    STORE_CONTEXT_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as StoreContextEnvSnapshot;

const restoreStoreContextEnv = (snapshot: StoreContextEnvSnapshot): void => {
  for (const key of STORE_CONTEXT_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

beforeEach(() => {
  previousStoreContextEnv = snapshotStoreContextEnv();
  clearStoreContextEnv();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  try {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  } finally {
    restoreStoreContextEnv(previousStoreContextEnv);
  }
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
    process.env.OPENDUCKTOR_CHANNEL = "preview";

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

  test("reads workspaceId-forbidden mode from the environment", async () => {
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
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "true";

    await expect(resolveStoreContext({})).resolves.toEqual({
      workspaceId: "repo",
      hostUrl: "http://127.0.0.1:14327",
      forbidWorkspaceIdInput: true,
    });
  });

  test("preserves explicit false for workspaceId-forbidden mode", async () => {
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
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "0";

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostUrl: "http://127.0.0.1:14327",
      forbidWorkspaceIdInput: false,
    });
  });

  test("rejects invalid workspaceId-forbidden mode values", async () => {
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";
    process.env.ODT_FORBID_WORKSPACE_ID_INPUT = "yes";

    await expect(resolveStoreContext({})).rejects.toThrow(
      "ODT_FORBID_WORKSPACE_ID_INPUT must be true, false, 1, or 0.",
    );
  });

  test("fails fast when the host health check fails", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "ODT_HOST_BRIDGE_ERROR",
              message: "host down",
            },
          },
          { status: 503, statusText: "Service Unavailable" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    process.env.ODT_WORKSPACE_ID = "repo";
    process.env.ODT_HOST_URL = "http://127.0.0.1:14327";

    await expect(resolveStoreContext({})).rejects.toThrow("host down");
  });

  test("discovers a running host from the discovery file when no explicit host is provided", async () => {
    const configDir = await createDiscoveryFile({
      hostToken: " discovery-token ",
      hostUrl: " http://127.0.0.1:14327 ",
    });
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.ODT_WORKSPACE_ID = "repo";
    const observedHostTokens: Array<string | undefined> = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:14327/health") {
        return jsonResponse({ ok: true });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_mcp_ready") {
        observedHostTokens.push(
          (init?.headers as Record<string, string> | undefined)?.["x-openducktor-app-token"],
        );
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      if (url === "http://127.0.0.1:14327/invoke/odt_get_workspaces") {
        observedHostTokens.push(
          (init?.headers as Record<string, string> | undefined)?.["x-openducktor-app-token"],
        );
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
      hostToken: "discovery-token",
    });
    expect(observedHostTokens).toEqual(["discovery-token", "discovery-token"]);
  });

  test("discovers the development host only from the dev channel descriptor", async () => {
    const configDir = await createDiscoveryFile({
      hostToken: "production-token",
      hostUrl: "http://127.0.0.1:14327",
    });
    await writeFile(
      join(configDir, "runtime", "mcp-bridge-dev.json"),
      JSON.stringify(
        {
          hostToken: "development-token",
          hostUrl: "http://127.0.0.1:24327",
          pid: 23456,
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.OPENDUCKTOR_CHANNEL = "dev";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:24327/health") {
        return jsonResponse({ ok: true });
      }
      if (url === "http://127.0.0.1:24327/invoke/odt_mcp_ready") {
        return jsonResponse({
          bridgeVersion: 1,
          toolNames: Object.keys(ODT_TOOL_SCHEMAS),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await expect(resolveStoreContext({})).resolves.toEqual({
      hostToken: "development-token",
      hostUrl: "http://127.0.0.1:24327",
    });
  });

  test("does not fall back from development discovery to production", async () => {
    const configDir = await createDiscoveryFile();
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
    process.env.OPENDUCKTOR_CHANNEL = "dev";

    await expect(resolveStoreContext({})).rejects.toThrow("mcp-bridge-dev.json");
  });

  test("does not fall back from production discovery to development", async () => {
    const configDir = await createEmptyConfigDir();
    await writeFile(
      join(configDir, "runtime", "mcp-bridge-dev.json"),
      JSON.stringify({
        hostToken: "development-token",
        hostUrl: "http://127.0.0.1:24327",
        pid: 23456,
      }),
      "utf8",
    );
    process.env.OPENDUCKTOR_CONFIG_DIR = configDir;

    await expect(resolveStoreContext({})).rejects.toThrow("mcp-bridge.json");
  });

  test("fails clearly when discovery cannot find any running host", async () => {
    const configDir = await createEmptyConfigDir();
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
