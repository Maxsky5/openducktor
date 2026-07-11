import { Effect } from "effect";
import type { CodexAppServerService } from "../../application/runtimes/codex-app-server-service";
import { HostOperationError } from "../../effect/host-errors";
import type {
  CodexAppServerProtocolMessage,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createCodexAppServerCommandHandlers } from "./codex-app-server-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const codexStatusNotification = {
  method: "thread/status/changed",
  params: { threadId: "thread-1", status: { type: "idle" } },
} satisfies CodexAppServerProtocolMessage;

const receivedAt = "2026-07-06T12:00:00.000Z";

describe("createCodexAppServerCommandHandlers", () => {
  test("forwards thread compaction requests to the Codex service", async () => {
    const requests: unknown[] = [];
    const service: CodexAppServerService = {
      request(input) {
        requests.push(input);
        return Effect.succeed({} as CodexAppServerRequestResult);
      },
      listLoadedThreads() {
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listThreads() {
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
      takeBufferedEvents() {
        return Effect.succeed([]);
      },
      respond() {
        return Effect.void;
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });

    await router.invoke("codex_app_server_request", {
      runtimeId: "runtime-1",
      method: "thread/compact/start",
      params: { threadId: "thread-1" },
    });

    expect(requests).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/compact/start",
        params: { threadId: "thread-1" },
      },
    ]);
  });

  test("logs Codex policy-bearing requests through the host logger", async () => {
    const infos: string[] = [];
    const service: CodexAppServerService = {
      request(input) {
        if (input.method === "thread/start") {
          return Effect.succeed({
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            cwd: "/repo",
            instructionSources: [],
            model: "gpt-5",
            modelProvider: "openai",
            reasoningEffort: "medium",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/repo"],
              networkAccess: true,
              excludeTmpdirEnvVar: true,
              excludeSlashTmp: true,
            },
            serviceTier: null,
            thread: {
              id: "thread-1",
              cwd: "/repo",
              createdAt: 1,
              updatedAt: 1,
              title: null,
              status: { type: "active", activeFlags: [] },
            },
          } as unknown as CodexAppServerRequestResult);
        }
        if (input.method === "turn/start") {
          return Effect.succeed({
            turn: {
              id: "turn-1",
              startedAt: 1,
              completedAt: null,
              durationMs: null,
              error: null,
              items: [],
              itemsView: "full",
              status: { type: "active" },
            },
          } as CodexAppServerRequestResult);
        }
        return Effect.succeed({ data: [], nextCursor: null } as CodexAppServerRequestResult);
      },
      listLoadedThreads() {
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listThreads() {
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
      takeBufferedEvents() {
        return Effect.succeed([]);
      },
      respond() {
        return Effect.void;
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service, {
        logger: {
          info: (message) => infos.push(message),
        },
      }),
    });

    await router.invoke("codex_app_server_request", {
      runtimeId: "runtime-1",
      method: "thread/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: "/repo",
        developerInstructions: "Use the repo rules.",
        sandbox: "workspace-write",
        model: "gpt-5",
        effort: "medium",
      },
    });
    await router.invoke("codex_app_server_request", {
      runtimeId: "runtime-1",
      method: "turn/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        threadId: "thread-1",
        input: [{ type: "text", text: "check network" }],
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/repo"],
          networkAccess: true,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
        model: "gpt-5",
        effort: "medium",
      },
    });
    await router.invoke("codex_app_server_request", {
      runtimeId: "runtime-1",
      method: "turn/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        threadId: "thread-1",
        input: [{ type: "text", text: "check read-only network" }],
        sandboxPolicy: {
          type: "readOnly",
          networkAccess: true,
        },
        model: "gpt-5",
        effort: "medium",
      },
    });

    expect(infos).toEqual([
      "Codex session policy thread/start runtime=runtime-1 thread=thread-1 cwd=/repo sandboxMode=workspace-write approvalPolicy=on-request promptReviewer=user networkAccess=true",
      "Codex session policy turn/start runtime=runtime-1 thread=thread-1 cwd=/repo sandboxMode=workspace-write approvalPolicy=on-request promptReviewer=user networkAccess=true",
      "Codex session policy turn/start runtime=runtime-1 thread=thread-1 cwd=unknown sandboxMode=read-only approvalPolicy=on-request promptReviewer=user networkAccess=true",
    ]);
  });

  test("routes Codex app-server commands to the service", async () => {
    const calls: Array<{
      method: keyof CodexAppServerService;
      input: unknown;
    }> = [];
    const service: CodexAppServerService = {
      request(input) {
        calls.push({ method: "request", input });
        if (input.method === "thread/name/set") {
          const result: Record<string, never> = {};
          return Effect.succeed(result);
        }
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
      takeBufferedEvents(input) {
        calls.push({ method: "takeBufferedEvents", input });
        return Effect.succeed([
          {
            runtimeId: input.runtimeId,
            kind: "notification" as const,
            receivedAt,
            message: codexStatusNotification,
          },
        ]);
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
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-1" },
      }),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "skills/list",
        params: { cwd: "/repo", forceReload: false },
      }),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "fuzzyFileSearch",
        params: { query: "src", roots: ["/repo"], cancellationToken: null },
      }),
    ).resolves.toEqual({ data: [], nextCursor: null });
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "thread/name/set",
        params: { threadId: "thread-1", name: "BUILD task-1" },
      }),
    ).resolves.toEqual({});
    await expect(
      router.invoke("codex_app_server_take_buffered_events", { runtimeId: "runtime-1" }),
    ).resolves.toEqual([
      {
        runtimeId: "runtime-1",
        kind: "notification",
        receivedAt,
        message: codexStatusNotification,
      },
    ]);
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: 7,
        result: { decision: "approved" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      router.invoke("codex_app_server_respond", {
        runtimeId: "runtime-1",
        requestId: "permission-request-1",
        result: { permissions: { network: { enabled: true } }, scope: "turn" },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        method: "request",
        input: { runtimeId: "runtime-1", method: "model/list", params: {} },
      },
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "turn/interrupt",
          params: { threadId: "thread-1", turnId: "turn-1" },
        },
      },
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "skills/list",
          params: { cwd: "/repo", forceReload: false },
        },
      },
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "fuzzyFileSearch",
          params: { query: "src", roots: ["/repo"], cancellationToken: null },
        },
      },
      {
        method: "request",
        input: {
          runtimeId: "runtime-1",
          method: "thread/name/set",
          params: { threadId: "thread-1", name: "BUILD task-1" },
        },
      },
      {
        method: "takeBufferedEvents",
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
      {
        method: "respond",
        input: {
          runtimeId: "runtime-1",
          requestId: "permission-request-1",
          result: { permissions: { network: { enabled: true } }, scope: "turn" },
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
      takeBufferedEvents(input) {
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
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "fuzzyFileSearch/sessionStart",
        params: {},
      }),
    ).rejects.toThrow("Unsupported Codex app-server request method: fuzzyFileSearch/sessionStart");
    await expect(
      router.invoke("codex_app_server_respond", { runtimeId: "runtime-1", requestId: 1.5 }),
    ).rejects.toThrow("requestId must be a non-empty string or non-negative integer.");
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
    await expect(router.invoke("codex_app_server_take_buffered_events")).rejects.toThrow(
      "codex_app_server_take_buffered_events input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});
