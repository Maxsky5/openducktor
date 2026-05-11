import type { CodexAppServerPort } from "../ports/codex-app-server-port";
import { createCodexAppServerService } from "./codex-app-server-service";

const createPort = (): { calls: unknown[]; port: CodexAppServerPort } => {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
      async request(input) {
        calls.push({ method: "request", input });
        return { ok: true };
      },
      async drainNotifications(runtimeId) {
        calls.push({ method: "drainNotifications", runtimeId });
        return [{ method: "codex/app-server/ready" }];
      },
      async drainServerRequests(runtimeId) {
        calls.push({ method: "drainServerRequests", runtimeId });
        return [{ id: 7, method: "approval/request" }];
      },
      async respond(input) {
        calls.push({ method: "respond", input });
      },
    },
  };
};

describe("createCodexAppServerService", () => {
  test("validates inputs and delegates Codex app-server operations", async () => {
    const { calls, port } = createPort();
    const service = createCodexAppServerService(port);

    await expect(
      service.request({
        runtimeId: " runtime-1 ",
        method: " model/list ",
        params: { request: "catalog" },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(service.notifications({ runtimeId: "runtime-1" })).resolves.toEqual([
      { method: "codex/app-server/ready" },
    ]);
    await expect(service.requests({ runtimeId: "runtime-1" })).resolves.toEqual([
      { id: 7, method: "approval/request" },
    ]);
    await expect(
      service.respond({
        runtimeId: "runtime-1",
        requestId: 7,
        error: { code: "denied" },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "model/list",
          params: { request: "catalog" },
        },
      },
      { method: "drainNotifications", runtimeId: "runtime-1" },
      { method: "drainServerRequests", runtimeId: "runtime-1" },
      {
        method: "respond",
        input: {
          runtimeId: "runtime-1",
          requestId: 7,
          error: { code: "denied" },
        },
      },
    ]);
  });

  test("rejects malformed command inputs before calling the port", async () => {
    const { calls, port } = createPort();
    const service = createCodexAppServerService(port);

    await expect(service.request({ runtimeId: "runtime-1", method: "" })).rejects.toThrow(
      "method is required.",
    );
    await expect(service.respond({ runtimeId: "runtime-1", requestId: 1.5 })).rejects.toThrow(
      "requestId must be a non-negative integer.",
    );
    await expect(service.notifications(null)).rejects.toThrow(
      "codex_app_server_notifications input must be an object.",
    );

    expect(calls).toEqual([]);
  });

  test("rejects non-array drain results", async () => {
    const service = createCodexAppServerService({
      async request() {
        return null;
      },
      async drainNotifications() {
        return null as unknown as unknown[];
      },
      async drainServerRequests() {
        return null as unknown as unknown[];
      },
      async respond() {},
    });

    await expect(service.notifications({ runtimeId: "runtime-1" })).rejects.toThrow(
      "codex_app_server_notifications must return an array.",
    );
    await expect(service.requests({ runtimeId: "runtime-1" })).rejects.toThrow(
      "codex_app_server_requests must return an array.",
    );
  });
});
