import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import { createCodexAppServerService as createEffectCodexAppServerService } from "./codex-app-server-service";

const createCodexAppServerService = (
  ...args: Parameters<typeof createEffectCodexAppServerService>
) => createEffectCodexAppServerService(...args);
const createPort = (): {
  calls: unknown[];
  port: CodexAppServerPort;
} => {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
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
      drainNotifications(runtimeId) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "drainNotifications", runtimeId });
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
      drainServerRequests(runtimeId) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ method: "drainServerRequests", runtimeId });
            return [{ id: 7, method: "approval/request" }];
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
    },
  };
};
describe("createCodexAppServerService", () => {
  test("delegates Codex app-server operations", async () => {
    const { calls, port } = createPort();
    const service = createCodexAppServerService(port);
    await expect(
      Effect.runPromise(
        service.request({
          runtimeId: "runtime-1",
          method: "model/list",
          params: { request: "catalog" },
        }),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      Effect.runPromise(service.notifications({ runtimeId: "runtime-1" })),
    ).resolves.toEqual([{ method: "codex/app-server/ready" }]);
    await expect(Effect.runPromise(service.requests({ runtimeId: "runtime-1" }))).resolves.toEqual([
      { id: 7, method: "approval/request" },
    ]);
    await expect(
      Effect.runPromise(
        service.respond({
          runtimeId: "runtime-1",
          requestId: 7,
          error: { code: "denied" },
        }),
      ),
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
  test("rejects non-array drain results", async () => {
    const service = createCodexAppServerService({
      request() {
        return Effect.tryPromise({
          try: async () => {
            return null;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      drainNotifications() {
        return Effect.tryPromise({
          try: async () => {
            return null as unknown as unknown[];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      drainServerRequests() {
        return Effect.tryPromise({
          try: async () => {
            return null as unknown as unknown[];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      respond() {
        return Effect.tryPromise({
          try: async () => {},
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    await expect(
      Effect.runPromise(service.notifications({ runtimeId: "runtime-1" })),
    ).rejects.toThrow("codex_app_server_notifications must return an array.");
    await expect(Effect.runPromise(service.requests({ runtimeId: "runtime-1" }))).rejects.toThrow(
      "codex_app_server_requests must return an array.",
    );
  });
});
