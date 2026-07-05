import { Effect } from "effect";
import type { CodexAppServerProtocolMessage } from "../../ports/codex-app-server-port";
import { createCodexAppServerTransportRegistry } from "./codex-app-server-transport-registry";

const codexStatusNotification = {
  method: "thread/status/changed",
  params: { threadId: "thread-1", status: { type: "idle" } },
} satisfies CodexAppServerProtocolMessage;

const codexApprovalRequest = {
  method: "execCommandApproval",
  id: 7,
  params: {
    conversationId: "thread-1",
    callId: "call-1",
    approvalId: null,
    command: ["true"],
    cwd: "/repo",
    reason: null,
    parsedCmd: [],
  },
} satisfies CodexAppServerProtocolMessage;

describe("createCodexAppServerTransportRegistry", () => {
  test("routes app-server operations to the registered runtime transport", async () => {
    const calls: unknown[] = [];
    const port = createCodexAppServerTransportRegistry();
    port.registerTransport("runtime-1", {
      request(input) {
        calls.push({ method: "request", input });
        if (input.method === "thread/loaded/list") {
          return Effect.succeed({ data: ["session-1"], nextCursor: null });
        }
        if (input.method === "thread/list") {
          return Effect.succeed({
            data: [
              {
                id: "session-1",
                sessionId: "session-1",
                forkedFromId: null,
                parentThreadId: null,
                preview: "Preview",
                ephemeral: false,
                modelProvider: "openai",
                createdAt: 1,
                updatedAt: 1,
                cwd: "/repo",
                path: null,
                cliVersion: "0.0.0-test",
                source: "appServer",
                threadSource: null,
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: null,
                status: { type: "active", activeFlags: [] },
                turns: [],
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
        return Effect.succeed({ data: [], nextCursor: null });
      },
      takeBufferedEvents() {
        calls.push({ method: "takeBufferedEvents" });
        return Effect.succeed([
          {
            runtimeId: "runtime-1",
            kind: "notification" as const,
            message: codexStatusNotification,
          },
          {
            runtimeId: "runtime-1",
            kind: "server_request" as const,
            message: codexApprovalRequest,
          },
        ]);
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
          params: {},
        }),
      ),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(Effect.runPromise(port.takeBufferedEvents("runtime-1"))).resolves.toEqual([
      { runtimeId: "runtime-1", kind: "notification", message: codexStatusNotification },
      { runtimeId: "runtime-1", kind: "server_request", message: codexApprovalRequest },
    ]);
    await expect(
      Effect.runPromise(
        port.listLoadedThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 }),
      ),
    ).resolves.toEqual({ data: ["session-1"], nextCursor: null });
    await expect(
      Effect.runPromise(port.listThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 })),
    ).resolves.toEqual({
      data: [{ id: "session-1", cwd: "/repo", status: "active" }],
      nextCursor: null,
      backwardsCursor: null,
    });
    await expect(
      Effect.runPromise(
        port.respond({
          runtimeId: "runtime-1",
          requestId: 7,
          result: { decision: "approved" },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        method: "request",
        input: { method: "model/list", params: {} },
      },
      { method: "takeBufferedEvents" },
      {
        method: "request",
        input: { method: "thread/loaded/list", params: { cursor: null, limit: 100 } },
      },
      {
        method: "request",
        input: { method: "thread/list", params: { cursor: null, limit: 100 } },
      },
      { method: "respond", input: { requestId: 7, result: { decision: "approved" } } },
    ]);
  });
  test("fails fast when a runtime transport is missing or duplicated", async () => {
    const port = createCodexAppServerTransportRegistry();
    await expect(
      Effect.runPromise(port.request({ runtimeId: "runtime-1", method: "model/list", params: {} })),
    ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    await expect(Effect.runPromise(port.takeBufferedEvents("runtime-1"))).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );
    await expect(
      Effect.runPromise(
        port.listLoadedThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 }),
      ),
    ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    await expect(
      Effect.runPromise(port.listThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 })),
    ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    await expect(
      Effect.runPromise(
        port.respond({
          runtimeId: "runtime-1",
          requestId: 7,
          result: { decision: "approved" },
        }),
      ),
    ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    const transport = {
      request() {
        return Effect.succeed({ data: [], nextCursor: null });
      },
      takeBufferedEvents() {
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
    await expect(Effect.runPromise(port.takeBufferedEvents("runtime-1"))).rejects.toThrow(
      "Codex app-server transport not found for runtime runtime-1",
    );
  });
});
