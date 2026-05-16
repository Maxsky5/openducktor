import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type McpBridgeDiscoveryFile,
  readMcpBridgeDiscoveryFile,
  removeMcpBridgeDiscoveryFile,
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
  test("removes the discovery file only when it still belongs to the current bridge", async () => {
    const { discoveryPath, tempDir } = await createTempDiscoveryPath();
    const current = discovery();

    try {
      await writeMcpBridgeDiscoveryFile(discoveryPath, current);
      await removeMcpBridgeDiscoveryFile(discoveryPath, current);

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
      await writeMcpBridgeDiscoveryFile(discoveryPath, newer);
      await removeMcpBridgeDiscoveryFile(discoveryPath, expected);

      await expect(readMcpBridgeDiscoveryFile(discoveryPath)).resolves.toEqual(newer);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
