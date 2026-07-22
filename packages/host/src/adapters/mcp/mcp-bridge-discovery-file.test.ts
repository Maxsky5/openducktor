import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  type McpBridgeDiscoveryFile,
  removeMcpBridgeDiscoveryFile,
  resolveMcpBridgeDiscoveryPath,
  writeMcpBridgeDiscoveryFile,
} from "./mcp-bridge-discovery-file";

const createTempDiscoveryPath = async (): Promise<{ discoveryPath: string; tempDir: string }> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-file-"));
  return {
    discoveryPath: path.join(tempDir, "runtime", "mcp-bridge.json"),
    tempDir,
  };
};

const discovery = (input: Partial<McpBridgeDiscoveryFile> = {}): McpBridgeDiscoveryFile => ({
  hostToken: "token",
  hostUrl: "http://127.0.0.1:4200",
  pid: 123,
  ...input,
});

describe("MCP bridge discovery file", () => {
  test("defaults discovery to the home OpenDucktor config root", () => {
    expect(resolveMcpBridgeDiscoveryPath("production", {})).toBe(
      path.join(homedir(), ".openducktor", "runtime", "mcp-bridge.json"),
    );
  });

  test("resolves development discovery under the same default config root", () => {
    expect(resolveMcpBridgeDiscoveryPath("development", {})).toBe(
      path.join(homedir(), ".openducktor", "runtime", "mcp-bridge-dev.json"),
    );
  });

  test("resolves discovery under the same configured OpenDucktor config root", () => {
    expect(
      resolveMcpBridgeDiscoveryPath("production", {
        OPENDUCKTOR_CONFIG_DIR: ` "~/.openducktor-local" `,
      }),
    ).toBe(path.join(homedir(), ".openducktor-local", "runtime", "mcp-bridge.json"));
  });

  test("resolves relative configured roots to absolute discovery paths", () => {
    expect(
      resolveMcpBridgeDiscoveryPath("production", {
        OPENDUCKTOR_CONFIG_DIR: "./.openducktor-local",
      }),
    ).toBe(path.resolve("./.openducktor-local", "runtime/mcp-bridge.json"));
  });

  test("publishing and removing development discovery preserves production discovery", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-modes-"));
    const env = { OPENDUCKTOR_CONFIG_DIR: tempDir };
    const productionPath = resolveMcpBridgeDiscoveryPath("production", env);
    const developmentPath = resolveMcpBridgeDiscoveryPath("development", env);
    const production = discovery({ hostToken: "production-token", pid: 123 });
    const development = discovery({ hostToken: "development-token", pid: 456 });
    const productionPayload = `${JSON.stringify(production, null, 2)}\n`;

    try {
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(productionPath, production));
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(developmentPath, development));
      await expect(readFile(productionPath, "utf8")).resolves.toBe(productionPayload);

      await Effect.runPromise(removeMcpBridgeDiscoveryFile(developmentPath, development));
      await expect(readFile(productionPath, "utf8")).resolves.toBe(productionPayload);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("publishing and removing production discovery preserves development discovery", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-mcp-discovery-modes-"));
    const env = { OPENDUCKTOR_CONFIG_DIR: tempDir };
    const productionPath = resolveMcpBridgeDiscoveryPath("production", env);
    const developmentPath = resolveMcpBridgeDiscoveryPath("development", env);
    const production = discovery({ hostToken: "production-token", pid: 123 });
    const development = discovery({ hostToken: "development-token", pid: 456 });
    const developmentPayload = `${JSON.stringify(development, null, 2)}\n`;

    try {
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(developmentPath, development));
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(productionPath, production));
      await expect(readFile(developmentPath, "utf8")).resolves.toBe(developmentPayload);

      await Effect.runPromise(removeMcpBridgeDiscoveryFile(productionPath, production));
      await expect(readFile(developmentPath, "utf8")).resolves.toBe(developmentPayload);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("removes the discovery file only when it still belongs to the current bridge", async () => {
    const { discoveryPath, tempDir } = await createTempDiscoveryPath();
    const current = discovery();

    try {
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(discoveryPath, current));
      await Effect.runPromise(removeMcpBridgeDiscoveryFile(discoveryPath, current));

      await expect(readFile(discoveryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("preserves a newer discovery file owned by another bridge", async () => {
    const { discoveryPath, tempDir } = await createTempDiscoveryPath();
    const expected = discovery({ hostToken: "old-token", pid: 123 });
    const newer = discovery({
      hostToken: "new-token",
      hostUrl: "http://127.0.0.1:4300",
      pid: 456,
    });

    try {
      await Effect.runPromise(writeMcpBridgeDiscoveryFile(discoveryPath, newer));
      await Effect.runPromise(removeMcpBridgeDiscoveryFile(discoveryPath, expected));

      await expect(readFile(discoveryPath, "utf8")).resolves.toBe(
        `${JSON.stringify(newer, null, 2)}\n`,
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("fails through the Effect error channel when discovery JSON is invalid", async () => {
    const { discoveryPath, tempDir } = await createTempDiscoveryPath();

    try {
      await mkdir(path.dirname(discoveryPath), { recursive: true });
      await writeFile(discoveryPath, "{not-json");

      await expect(
        Effect.runPromise(removeMcpBridgeDiscoveryFile(discoveryPath, discovery())),
      ).rejects.toThrow("JSON Parse error");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
