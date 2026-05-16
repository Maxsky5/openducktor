import { Effect } from "effect";
import type { CodexAppServerService } from "../../application/runtimes/codex-app-server-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createCodexAppServerCommandHandlers } from "./codex-app-server-command-handlers";

const createCodexAppServerServiceFake = (service: CodexAppServerService): CodexAppServerService =>
  service as CodexAppServerService;
describe("createCodexAppServerCommandHandlers", () => {
  test("routes Codex app-server commands to the service", async () => {
    const calls: Array<{
      method: keyof CodexAppServerService;
      input: unknown;
    }> = [];
    const service = createCodexAppServerServiceFake({
      request(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "request", input });
            return { ok: true };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      notifications(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "notifications", input });
            return [{ method: "codex/app-server/ready" }];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      requests(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "requests", input });
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      respond(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "respond", input });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
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
  test("rejects malformed command inputs before calling the service", async () => {
    const calls: unknown[] = [];
    const service = createCodexAppServerServiceFake({
      request(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      notifications(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      requests(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            throw new Error("unexpected call");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      respond(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });
    await expect(
      router.invoke("codex_app_server_request", { runtimeId: "runtime-1", method: "" }),
    ).rejects.toThrow("method is required.");
    await expect(
      router.invoke("codex_app_server_respond", { runtimeId: "runtime-1", requestId: 1.5 }),
    ).rejects.toThrow("requestId must be a non-negative integer.");
    await expect(router.invoke("codex_app_server_notifications")).rejects.toThrow(
      "codex_app_server_notifications input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});
