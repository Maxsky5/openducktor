import type { ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createCodexAppServerTransport } from "./codex-app-server-transport";

const createChild = (): ChildProcessByStdio<PassThrough, PassThrough, PassThrough> => {
  const child = new EventEmitter() as ChildProcessByStdio<PassThrough, PassThrough, PassThrough>;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
};

const waitForStreamEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("createCodexAppServerTransport", () => {
  test("keeps emitted notifications drainable after a request response", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const response = transport.request({
      method: "thread/read",
      params: { threadId: "thread-1", includeTurns: true },
    });
    const notification = {
      jsonrpc: "2.0",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: { totalTokens: 10 },
          last: { totalTokens: 10 },
          modelContextWindow: 200,
        },
      },
    };

    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`);
    child.stdout.write(`${JSON.stringify(notification)}\n`);

    await expect(response).resolves.toEqual({ ok: true });
    expect(emitted).toEqual([
      { runtimeId: "runtime-1", kind: "notification", message: notification },
    ]);
    await expect(transport.drainNotifications()).resolves.toEqual([notification]);

    await transport.close();
  });

  test("does not retain emitted server requests for later drain polling", async () => {
    const child = createChild();
    const emitted: unknown[] = [];
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000, (event) =>
      emitted.push(event),
    );
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "askForApproval",
      params: { threadId: "thread-1" },
    };

    child.stdout.write(`${JSON.stringify(request)}\n`);

    expect(emitted).toEqual([{ runtimeId: "runtime-1", kind: "server_request", message: request }]);
    await expect(transport.drainServerRequests()).resolves.toEqual([]);

    await transport.close();
  });

  test("bounds captured stderr used in process-close diagnostics", async () => {
    const child = createChild();
    const transport = createCodexAppServerTransport("runtime-1", child, 1_000);

    child.stderr.write("first-error-line\n");
    child.stderr.write(`${"x".repeat(70 * 1024)}\n`);
    child.stderr.write("latest-error-line\n");
    await waitForStreamEvents();
    child.emit("close", 1, null);

    await expect(transport.request({ method: "thread/read" })).rejects.toThrow(
      /Codex app-server closed: process exited with code 1 for runtime runtime-1: .*latest-error-line/s,
    );
    await expect(transport.request({ method: "thread/read" })).rejects.not.toThrow(
      "first-error-line",
    );
  });
});
