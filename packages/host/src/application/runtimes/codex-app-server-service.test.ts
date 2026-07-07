import { Effect } from "effect";
import type {
  CodexAppServerPort,
  CodexAppServerProtocolMessage,
} from "../../ports/codex-app-server-port";
import { createCodexAppServerService as createEffectCodexAppServerService } from "./codex-app-server-service";

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

const receivedAt = "2026-07-06T12:00:00.000Z";

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
        calls.push({ method: "request", input });
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listLoadedThreads(input) {
        calls.push({ method: "listLoadedThreads", input });
        return Effect.succeed({ data: ["session-1"], nextCursor: null });
      },
      listThreads(input) {
        calls.push({ method: "listThreads", input });
        return Effect.succeed({
          data: [{ id: "session-1", cwd: "/repo", status: "active" }],
          nextCursor: null,
          backwardsCursor: null,
        });
      },
      takeBufferedEvents(runtimeId) {
        calls.push({ method: "takeBufferedEvents", runtimeId });
        return Effect.succeed([
          {
            runtimeId,
            kind: "notification" as const,
            receivedAt,
            message: codexStatusNotification,
          },
          { runtimeId, kind: "server_request" as const, receivedAt, message: codexApprovalRequest },
        ]);
      },
      respond(input) {
        calls.push({ method: "respond", input });
        return Effect.void;
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
          params: {},
        }),
      ),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(
      Effect.runPromise(service.takeBufferedEvents({ runtimeId: "runtime-1" })),
    ).resolves.toEqual([
      {
        runtimeId: "runtime-1",
        kind: "notification",
        receivedAt,
        message: codexStatusNotification,
      },
      {
        runtimeId: "runtime-1",
        kind: "server_request",
        receivedAt,
        message: codexApprovalRequest,
      },
    ]);
    await expect(
      Effect.runPromise(
        service.listLoadedThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 }),
      ),
    ).resolves.toEqual({ data: ["session-1"], nextCursor: null });
    await expect(
      Effect.runPromise(service.listThreads({ runtimeId: "runtime-1", cursor: null, limit: 100 })),
    ).resolves.toEqual({
      data: [{ id: "session-1", cwd: "/repo", status: "active" }],
      nextCursor: null,
      backwardsCursor: null,
    });
    await expect(
      Effect.runPromise(
        service.respond({
          runtimeId: "runtime-1",
          requestId: 7,
          error: { code: -32000, message: "denied" },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "model/list",
          params: {},
        },
      },
      { method: "takeBufferedEvents", runtimeId: "runtime-1" },
      {
        method: "listLoadedThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
      {
        method: "listThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
      {
        method: "respond",
        input: {
          runtimeId: "runtime-1",
          requestId: 7,
          error: { code: -32000, message: "denied" },
        },
      },
    ]);
  });
});
