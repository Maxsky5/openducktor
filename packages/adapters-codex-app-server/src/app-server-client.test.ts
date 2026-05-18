import { describe, expect, test } from "bun:test";
import { createCodexAppServerClient } from "./app-server-client";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./types";

describe("createCodexAppServerClient", () => {
  test("sends turn/interrupt requests", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        return {};
      },
    };
    const client = createCodexAppServerClient(transport);
    await expect(client.turnInterrupt({ threadId: "thread-1", turnId: "turn-1" })).resolves.toEqual(
      {},
    );
    expect(calls).toEqual([
      {
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
    ]);
  });
});
