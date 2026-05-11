import { createCodexAppServerCommandHandlers } from "./codex-app-server-command-handlers";
import type { CodexAppServerService } from "./codex-app-server-service";
import { createHostCommandRouter } from "./host-command-router";

describe("createCodexAppServerCommandHandlers", () => {
  test("routes Codex app-server commands to the service", async () => {
    const calls: Array<{ method: keyof CodexAppServerService; input: unknown }> = [];
    const service: CodexAppServerService = {
      async request(input) {
        calls.push({ method: "request", input });
        return { ok: true };
      },
      async notifications(input) {
        calls.push({ method: "notifications", input });
        return [{ method: "codex/app-server/ready" }];
      },
      async requests(input) {
        calls.push({ method: "requests", input });
        return [];
      },
      async respond(input) {
        calls.push({ method: "respond", input });
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });

    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "model/list",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("codex_app_server_notifications", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([{ method: "codex/app-server/ready" }]);
    await expect(
      router.invoke("codex_app_server_requests", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([]);
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: 7,
        result: { approved: true },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        method: "request",
        input: { runtimeId: "runtime-1", method: "model/list" },
      },
      {
        method: "notifications",
        input: { runtimeId: "runtime-1" },
      },
      {
        method: "requests",
        input: { runtimeId: "runtime-1" },
      },
      {
        method: "respond",
        input: {
          runtimeId: "runtime-1",
          requestId: 7,
          result: { approved: true },
        },
      },
    ]);
  });
});
