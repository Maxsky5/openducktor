import type { CodexAppServerRequestInput } from "../../ports/codex-app-server-port";
import { Effect } from "effect";
import type { CodexAppServerService } from "../../application/runtimes/codex-app-server-service";
import { HostOperationError } from "../../effect/host-errors";
import {
  jsonValueSchema,
  parseCodexAppServerRequestResult,
  type CodexAppServerRequestMethod,
  type JsonValue,
} from "@openducktor/contracts";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createCodexAppServerCommandHandlers } from "./codex-app-server-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const codexResult = (method: CodexAppServerRequestMethod, value: JsonValue) =>
  parseCodexAppServerRequestResult(method, value);

const threadStartResult = (threadId = "thread-1") =>
  codexResult("thread/start", {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    activePermissionProfile: null,
    cwd: "/repo",
    instructionSources: [],
    model: "gpt-5",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: ["/repo"],
    sandbox: {
      type: "workspaceWrite",
      writableRoots: ["/repo"],
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
    serviceTier: null,
    thread: {
      id: threadId,
      extra: null,
      sessionId: threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview: "Test thread",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: "paginated",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 1,
      recencyAt: 1,
      status: { type: "active", activeFlags: [] },
      path: null,
      cwd: "/repo",
      cliVersion: "0.149.0-test",
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    },
  });

describe("createCodexAppServerCommandHandlers", () => {
  test("forwards thread compaction requests to the Codex service", async () => {
    const requests: unknown[] = [];
    const service: CodexAppServerService = {
      request(input) {
        requests.push(input);
        return Effect.succeed(codexResult("thread/compact/start", {}));
      },
      listLoadedThreads() {
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listThreads() {
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
      listThreadTurns: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
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
          return Effect.succeed(threadStartResult());
        }
        if (input.method === "turn/start") {
          return Effect.succeed(
            codexResult("turn/start", {
              turn: {
                id: "turn-1",
                startedAt: 1,
                completedAt: null,
                durationMs: null,
                error: null,
                items: [],
                itemsView: "full",
                status: "inProgress",
              },
            }),
          );
        }
        return Effect.succeed(codexResult("model/list", { data: [], nextCursor: null }));
      },
      listLoadedThreads() {
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listThreads() {
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
      listThreadTurns: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service, {
        logger: {
          info: (message) => Effect.sync(() => infos.push(message)),
          error: () => Effect.void,
        },
        onBackgroundFailure: () => Effect.void,
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
      },
    });
    await router.invoke("codex_app_server_request", {
      runtimeId: "runtime-1",
      method: "turn/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        threadId: "thread-1",
        input: [{ type: "text", text: "check network", text_elements: [] }],
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
        input: [{ type: "text", text: "check read-only network", text_elements: [] }],
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

  test("reports policy log failures without failing a completed Codex request", async () => {
    const committedResult = threadStartResult();
    const persistenceFailure = new HostOperationError({
      operation: "openducktor.logs.append",
      message: "log append failed",
    });
    const reportedFailures: HostOperationError[] = [];
    const service: CodexAppServerService = {
      request: () => Effect.succeed(committedResult),
      listLoadedThreads: () => Effect.succeed({ data: [], nextCursor: null }),
      listThreads: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
      listThreadTurns: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service, {
        logger: {
          info: () => Effect.fail(persistenceFailure),
          error: () => Effect.void,
        },
        onBackgroundFailure: (failure) =>
          Effect.sync(() => {
            reportedFailures.push(failure);
          }),
      }),
    });

    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "thread/start",
        params: { cwd: "/repo" },
      }),
    ).resolves.toEqual(jsonValueSchema.parse(committedResult));
    expect(reportedFailures).toEqual([
      expect.objectContaining({
        _tag: "HostOperationError",
        operation: "host.lifecycle.log-info",
        cause: persistenceFailure,
      }),
    ]);
  });

  test("routes Codex app-server commands to the service", async () => {
    const calls: Array<{
      method: keyof CodexAppServerService;
      input: CodexAppServerRequestInput | unknown;
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
      listThreadTurns: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
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
        params: { cwds: ["/repo"], forceReload: false },
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
          params: { cwds: ["/repo"], forceReload: false },
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
    ]);
  });

  test("routes thread turn pages through the validated history operation", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const service: CodexAppServerService = {
      request(input) {
        calls.push({ method: "request", input });
        return Effect.succeed({ data: [], nextCursor: null });
      },
      listLoadedThreads: () => Effect.succeed({ data: [], nextCursor: null }),
      listThreads: () => Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null }),
      listThreadTurns(input) {
        calls.push({ method: "listThreadTurns", input });
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      },
    };
    const router = createHostCommandRouter({
      handlers: createCodexAppServerCommandHandlers(service),
    });

    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "thread/turns/list",
        params: {
          threadId: "thread-1",
          cursor: "cursor-1",
          limit: 100,
          sortDirection: "asc",
          itemsView: "full",
        },
      }),
    ).resolves.toEqual({ data: [], nextCursor: null, backwardsCursor: null });
    await expect(
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "thread/turns/list",
        params: {
          threadId: "thread-1",
          cursor: null,
          limit: null,
          sortDirection: null,
          itemsView: null,
        },
      }),
    ).resolves.toEqual({ data: [], nextCursor: null, backwardsCursor: null });
    expect(calls).toEqual([
      {
        method: "listThreadTurns",
        input: {
          runtimeId: "runtime-1",
          threadId: "thread-1",
          cursor: "cursor-1",
          limit: 100,
          sortDirection: "asc",
          itemsView: "full",
        },
      },
      {
        method: "listThreadTurns",
        input: {
          runtimeId: "runtime-1",
          threadId: "thread-1",
          cursor: null,
          limit: null,
          sortDirection: null,
          itemsView: null,
        },
      },
    ]);
  });

  test("rejects malformed command inputs before calling the service", async () => {
    const calls: unknown[] = [];
    const nonJsonParams = { omitted: undefined } satisfies object;
    const unexpectedCall = (input: CodexAppServerRequestInput | unknown) =>
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
      listThreadTurns: () => Effect.dieMessage("unexpected call"),
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
      router.invoke("codex_app_server_request", {
        runtimeId: "runtime-1",
        method: "model/list",
        params: nonJsonParams,
      }),
    ).rejects.toThrow("params must be JSON-serializable.");
    for (const params of [null, true, 1, "params", []]) {
      await expect(
        router.invoke("codex_app_server_request", {
          runtimeId: "runtime-1",
          method: "model/list",
          params,
        }),
      ).rejects.toThrow("Invalid Codex app-server request params for method model/list");
    }
    expect(calls).toEqual([]);
  });
});
