import { Effect } from "effect";
import { createCodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";

describe("createCodexAppServerTransportRegistry", () => {
  test("routes app-server operations to the registered runtime transport", async () => {
    const calls: unknown[] = [];
    const port = createCodexAppServerTransportRegistry();
    port.registerTransport("runtime-1", {
      request(input) {
        calls.push({ method: "request", input });
        return Effect.succeed({ result: true });
      },
      drainNotifications() {
        calls.push({ method: "drainNotifications" });
        return Effect.succeed([{ method: "codex/ready" }]);
      },
      drainServerRequests() {
        calls.push({ method: "drainServerRequests" });
        return Effect.succeed([{ id: 7, method: "approval/request" }]);
      },
      respond(input) {
        calls.push({ method: "respond", input });
        return Effect.succeed(undefined);
      },
    });
    await expect(
      Effect.runPromise(
        port.request({
          runtimeId: "runtime-1",
          method: "model/list",
          params: { request: "catalog" },
        }),
      ),
    ).resolves.toEqual({ result: true });
    await expect(Effect.runPromise(port.drainNotifications("runtime-1"))).resolves.toEqual([
      { method: "codex/ready" },
    ]);
    await expect(Effect.runPromise(port.drainServerRequests("runtime-1"))).resolves.toEqual([
      { id: 7, method: "approval/request" },
    ]);
    await expect(
      Effect.runPromise(
        port.respond({
          runtimeId: "runtime-1",
          requestId: 7,
          result: { approved: true },
        }),
      ),
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
    const port = createCodexAppServerTransportRegistry();
    await expect(Effect.runPromise(port.drainNotifications("runtime-1"))).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );
    const transport = {
      request() {
        return Effect.succeed(null);
      },
      drainNotifications() {
        return Effect.succeed([]);
      },
      drainServerRequests() {
        return Effect.succeed([]);
      },
      respond() {
        return Effect.succeed(undefined);
      },
    };
    port.registerTransport("runtime-1", transport);
    expect(() => port.registerTransport("runtime-1", transport)).toThrow(
      "Codex app-server transport already registered for runtime runtime-1",
    );
    port.unregisterTransport("runtime-1");
    await expect(Effect.runPromise(port.drainServerRequests("runtime-1"))).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );
  });
});
