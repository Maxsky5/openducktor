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
      drainNotifications(runtimeId) {
        calls.push({ method: "drainNotifications", runtimeId });
        return Effect.succeed([codexStatusNotification]);
      },
      drainServerRequests(runtimeId) {
        calls.push({ method: "drainServerRequests", runtimeId });
        return Effect.succeed([codexApprovalRequest]);
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
      Effect.runPromise(service.notifications({ runtimeId: "runtime-1" })),
    ).resolves.toEqual([codexStatusNotification]);
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
    await expect(Effect.runPromise(service.requests({ runtimeId: "runtime-1" }))).resolves.toEqual([
      codexApprovalRequest,
    ]);
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
      { method: "drainNotifications", runtimeId: "runtime-1" },
      {
        method: "listLoadedThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
      {
        method: "listThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
      { method: "drainServerRequests", runtimeId: "runtime-1" },
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
