import { createInMemoryCodexAppServerPort } from "./in-memory-codex-app-server-port";

describe("createInMemoryCodexAppServerPort", () => {
  test("routes app-server operations to the registered runtime transport", async () => {
    const calls: unknown[] = [];
    const port = createInMemoryCodexAppServerPort();
    port.registerTransport("runtime-1", {
      async request(input) {
        calls.push({ method: "request", input });
        return { result: true };
      },
      async drainNotifications() {
        calls.push({ method: "drainNotifications" });
        return [{ method: "codex/ready" }];
      },
      async drainServerRequests() {
        calls.push({ method: "drainServerRequests" });
        return [{ id: 7, method: "approval/request" }];
      },
      async respond(input) {
        calls.push({ method: "respond", input });
      },
    });

    await expect(
      port.request({
        runtimeId: "runtime-1",
        method: "model/list",
        params: { request: "catalog" },
      }),
    ).resolves.toEqual({ result: true });
    await expect(port.drainNotifications("runtime-1")).resolves.toEqual([
      { method: "codex/ready" },
    ]);
    await expect(port.drainServerRequests("runtime-1")).resolves.toEqual([
      { id: 7, method: "approval/request" },
    ]);
    await expect(
      port.respond({
        runtimeId: "runtime-1",
        requestId: 7,
        result: { approved: true },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        method: "request",
        input: { method: "model/list", params: { request: "catalog" } },
      },
      { method: "drainNotifications" },
      { method: "drainServerRequests" },
      { method: "respond", input: { requestId: 7, result: { approved: true } } },
    ]);
  });

  test("fails fast when a runtime transport is missing or duplicated", async () => {
    const port = createInMemoryCodexAppServerPort();

    await expect(port.drainNotifications("runtime-1")).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );

    const transport = {
      async request() {
        return null;
      },
      async drainNotifications() {
        return [];
      },
      async drainServerRequests() {
        return [];
      },
      async respond() {},
    };
    port.registerTransport("runtime-1", transport);
    expect(() => port.registerTransport("runtime-1", transport)).toThrow(
      "Codex app-server transport already registered for runtime runtime-1",
    );

    port.unregisterTransport("runtime-1");
    await expect(port.drainServerRequests("runtime-1")).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );
  });
});
