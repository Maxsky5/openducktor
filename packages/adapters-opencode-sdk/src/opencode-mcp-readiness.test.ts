import { expect, test } from "bun:test";
import { makeMockClient, OpencodeSdkAdapter, defaultRepoRuntimeInput } from "./test-support";

test.each(["status", "connect"] as const)(
  "MCP %s failures block session creation without permission or prompt requests",
  async (operation) => {
    const mock = makeMockClient();
    mock.client.mcp.status = async () => {
      if (operation === "status") throw new Error("native status unavailable");
      return {
        data: { openducktor: { status: "failed", error: "connection closed" } },
        error: undefined,
      };
    };
    mock.client.mcp.connect = async () => {
      throw new Error("native reconnect unavailable");
    };
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    await expect(
      adapter.startSession({ ...defaultRepoRuntimeInput, systemPrompt: "Start" }),
    ).rejects.toThrow(
      operation === "status" ? "native status unavailable" : "native reconnect unavailable",
    );
    expect(mock.session.createCalls).toEqual([]);
    expect(mock.session.updateCalls).toEqual([]);
    expect(mock.session.promptAsyncCalls).toEqual([]);
  },
);
