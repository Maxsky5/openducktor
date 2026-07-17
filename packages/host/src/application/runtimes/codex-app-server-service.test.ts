import { Effect } from "effect";
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
    expect(calls).toEqual([
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "model/list",
          params: {},
        },
      },
      {
        method: "listLoadedThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
      {
        method: "listThreads",
        input: { runtimeId: "runtime-1", cursor: null, limit: 100 },
      },
    ]);
  });
});
