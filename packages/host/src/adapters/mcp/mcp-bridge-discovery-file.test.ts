import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  type McpBridgeDiscoveryFile,
  readMcpBridgeDiscoveryFile,
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
  test("resolves discovery under the same configured OpenDucktor config root", () => {
    expect(
      resolveMcpBridgeDiscoveryPath({ OPENDUCKTOR_CONFIG_DIR: ` "~/.openducktor-local" ` }),
    ).toBe(path.join(homedir(), ".openducktor-local", "runtime", "mcp-bridge.json"));
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

      await expect(Effect.runPromise(readMcpBridgeDiscoveryFile(discoveryPath))).resolves.toEqual(
        newer,
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

      await expect(Effect.runPromise(readMcpBridgeDiscoveryFile(discoveryPath))).rejects.toThrow(
        "JSON Parse error",
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
