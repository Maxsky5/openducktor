import { Effect } from "effect";
import type { CodexAppServerService } from "../../application/runtimes/codex-app-server-service";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerProtocolMessage } from "../../ports/codex-app-server-port";
import { createHostCommandRouter } from "../router/host-command-router";
import { createCodexAppServerCommandHandlers } from "./codex-app-server-command-handlers";

const codexStatusNotification = {
  method: "thread/status/changed",
  params: { threadId: "thread-1", status: { type: "idle" } },
} satisfies CodexAppServerProtocolMessage;

describe("createCodexAppServerCommandHandlers", () => {
  test("routes Codex app-server commands to the service", async () => {
    const calls: Array<{
      method: keyof CodexAppServerService;
      input: unknown;
    }> = [];
    const service: CodexAppServerService = {
      request(input) {
        calls.push({ method: "request", input });
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listLoadedThreads(input) {
        calls.push({ method: "listLoadedThreads", input });
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listThreads(input) {
        calls.push({ method: "listThreads", input });
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
      notifications(input) {
        calls.push({ method: "notifications", input });
        return Effect.succeed([codexStatusNotification]);
      },
      requests(input) {
        calls.push({ method: "requests", input });
        return Effect.succeed([]);
      },
      respond(input) {
        calls.push({ method: "respond", input });
        return Effect.void;
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "model/list",
        params: {},
      }),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(
      router.invoke("codex_app_server_notifications", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([codexStatusNotification]);
    await expect(
      router.invoke("codex_app_server_requests", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([]);
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: 7,
        result: { decision: "approved" },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        method: "request",
        input: { runtimeId: "runtime-1", method: "model/list", params: {} },
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
          result: { decision: "approved" },
        },
      },
    ]);
  });
  test("rejects malformed command inputs before calling the service", async () => {
    const calls: unknown[] = [];
    const unexpectedCall = (input: unknown) =>
      Effect.sync(() => {
        calls.push(input);
      }).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new HostOperationError({
              operation: "test.effect",
              message: "unexpected call",
            }),
          ),
        ),
      );
    const service: CodexAppServerService = {
      request(input) {
        return unexpectedCall(input);
      },
      listLoadedThreads() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected call",
          }),
        );
      },
      listThreads() {
        return Effect.fail(
          new HostOperationError({
            operation: "test.effect",
            message: "unexpected call",
          }),
        );
      },
      notifications(input) {
        return unexpectedCall(input);
      },
      requests(input) {
        return unexpectedCall(input);
      },
      respond(input) {
        return unexpectedCall(input);
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });
    await expect(
      router.invoke("codex_app_server_request", { runtimeId: "runtime-1", method: "" }),
    ).rejects.toThrow("method is required.");
    await expect(
      router.invoke("codex_app_server_respond", { runtimeId: "runtime-1", requestId: 1.5 }),
    ).rejects.toThrow("requestId must be a non-negative integer.");
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "model/list",
        params: { omitted: undefined },
      }),
    ).rejects.toThrow("params must be JSON-serializable.");
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: 1,
        result: { omitted: undefined },
      }),
    ).rejects.toThrow("result must be JSON-serializable.");
    await expect(router.invoke("codex_app_server_notifications")).rejects.toThrow(
      "codex_app_server_notifications input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});
