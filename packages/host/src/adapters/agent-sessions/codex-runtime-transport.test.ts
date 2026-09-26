import { expect, mock, test } from "bun:test";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_CODEX_RUNTIME_POLICY,
  type CodexAppServerThread,
} from "@openducktor/contracts";
import { AgentRuntimeQueryError, workflowAgentSessionScope } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import { createCodexRuntimeTransport } from "./codex-runtime-transport";
import { toRuntimeQueryError } from "./runtime-query-adapter";
import { createCodexAppServerTransportRegistry } from "../codex/codex-app-server-transport-registry";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";

const createTransportWithRequest = (
  request: Parameters<typeof createCodexRuntimeTransport>[0]["request"],
) =>
  createCodexRuntimeTransport(
    {
      request,
      listLoadedThreads: () => Effect.dieMessage("Unexpected listLoadedThreads"),
      listThreads: () => Effect.dieMessage("Unexpected listThreads"),
      respond: () => Effect.dieMessage("Unexpected respond"),
      listThreadTurns: () => Effect.dieMessage("Unexpected listThreadTurns"),
    },
    "private-runtime",
  );

test("an actual missing-transport failure keeps native identity inside the host", async () => {
  const registry = createCodexAppServerTransportRegistry();
  const error = await Effect.runPromise(
    Effect.flip(
      registry.listThreadTurns({
        runtimeId: "private-runtime-repro",
        threadId: "thread-1",
      }),
    ),
  );
  expect(error.failure.detail).toContain("private-runtime-repro");
  const failure = hostInvokeFailureFromError(
    toRuntimeQueryError(
      "load session history",
      { repoPath: "/repo", runtimeKind: "codex", externalSessionId: "thread-1" },
      error,
    ),
  );
  expect(failure).toMatchObject({
    kind: "runtime_query",
    runtimeQueryFailure: {
      code: "request_failed",
      sessionHistoryFailure: {
        diagnosticId: error.failure.diagnosticId,
        method: "thread/turns/list",
      },
    },
  });
  expect(JSON.stringify(failure)).not.toContain("private-runtime-repro");
});

test("host-native Codex queries preserve paged history diagnostics", async () => {
  const failure = {
    code: "invalid_runtime_response" as const,
    summary: "Codex returned invalid conversation history.",
    detail: "Native runtime private-runtime at http://127.0.0.1:9999 failed with token=secret.",
    diagnosticId: "diagnostic-1",
    method: "thread/turns/list" as const,
    pageCursor: "page-2",
  };
  const error = new CodexSessionHistoryError({
    message: failure.summary,
    failure,
    runtimeId: "private-runtime",
    threadId: "thread-1",
  });
  const listThreadTurns = mock(() => Effect.fail(error));
  const transport = createCodexRuntimeTransport(
    {
      request: () => Effect.dieMessage("Unexpected raw request"),
      listLoadedThreads: () => Effect.dieMessage("Unexpected listLoadedThreads"),
      listThreads: () => Effect.dieMessage("Unexpected listThreads"),
      respond: () => Effect.dieMessage("Unexpected respond"),
      listThreadTurns,
    },
    "private-runtime",
  );
  const request = {
    method: "thread/turns/list" as const,
    params: { threadId: "thread-1", cursor: "page-2" },
  };
  await expect(transport.request(request)).rejects.toBe(error);
  expect(listThreadTurns).toHaveBeenCalledWith({ runtimeId: "private-runtime", ...request.params });
  const queryError = toRuntimeQueryError(
    "load session history",
    { repoPath: "/repo", runtimeKind: "codex", externalSessionId: "thread-1" },
    error,
  );
  expect(queryError.failure.sessionHistoryFailure).toMatchObject({
    code: failure.code,
    method: failure.method,
    diagnosticId: failure.diagnosticId,
    pageCursor: failure.pageCursor,
  });
  expect(JSON.stringify(queryError.failure)).not.toContain("private-runtime");
  expect(JSON.stringify(queryError.failure)).not.toContain("127.0.0.1");
  expect(JSON.stringify(queryError.failure)).not.toContain("secret");
  expect(queryError.cause).toBe(error);
});

test("reports a dead Codex transport as an unreachable runtime", async () => {
  const transportLoss = new HostOperationError({
    operation: "codexAppServerTransport.request.model/list",
    message: "Codex app-server request model/list failed for runtime private-runtime",
    cause: new HostOperationError({
      operation: "codexAppServerTransport.childProcess",
      message: "Codex app-server closed for runtime private-runtime",
    }),
  });
  const transport = createTransportWithRequest(() => Effect.fail(transportLoss));

  const error = await transport
    .request({ method: "model/list", params: {} })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(AgentRuntimeQueryError);
  expect(error).toMatchObject({ code: "runtime_unavailable" });
  const queryError = toRuntimeQueryError(
    "load runtime catalog",
    { repoPath: "/repo", runtimeKind: "codex", workingDirectory: "/repo" },
    error,
  );
  expect(queryError.failure.code).toBe("runtime_unavailable");
  expect(JSON.stringify(queryError.failure)).not.toContain("private-runtime");
});

test("keeps a Codex RPC error isolated to the calling surface", async () => {
  const rpcError = new HostOperationError({
    operation: "codexAppServerTransport.request.model/list",
    message: "Codex app-server request model/list failed",
    cause: { code: -32602, message: "Invalid params" },
  });
  const transport = createTransportWithRequest(() => Effect.fail(rpcError));

  await expect(transport.request({ method: "model/list", params: {} })).rejects.toBe(rpcError);
});

test("fresh history and todos accept the host-wrapped empty rollout error", async () => {
  const runtimeId = "runtime-live";
  const threadId = "thread/start-runtime-live";
  const thread: CodexAppServerThread = {
    id: threadId,
    extra: null,
    sessionId: threadId,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1_778_112_000,
    updatedAt: 1_778_112_000,
    recencyAt: 1_778_112_000,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd: "/repo",
    cliVersion: "0.156.0-test",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
  const scope = workflowAgentSessionScope("task-1", "build");
  const runtimePolicy = {
    kind: "codex" as const,
    policy: { ...DEFAULT_CODEX_RUNTIME_POLICY, approvalsReviewerApplies: true },
  };
  const ref = {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    externalSessionId: threadId,
    sessionScope: scope,
    runtimePolicy,
  };
  const nativeMethods: string[] = [];
  const registry = createCodexAppServerTransportRegistry();
  let turnsFail = true;
  const rawError = new HostOperationError({
    operation: "codexAppServerTransport.request.thread/turns/list",
    message: "Codex app-server request thread/turns/list failed",
    cause: {
      code: -32603,
      message:
        "failed to read thread: thread-store internal error: failed to read session metadata /repo/rollout.jsonl: thread-store internal error: failed to read session metadata /repo/rollout.jsonl: rollout at /repo/rollout.jsonl is empty",
    },
    details: { method: "thread/turns/list" },
  });
  registry.registerTransport(runtimeId, {
    request: (input) => {
      nativeMethods.push(input.method);
      if (input.method === "thread/turns/list" && turnsFail) return Effect.fail(rawError);
      if (input.method === "initialize") {
        return Effect.succeed({
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex_cli_rs/0.156.0-test",
        });
      }
      if (input.method === "model/list") {
        return Effect.succeed({
          data: [
            {
              id: "gpt-5",
              additionalSpeedTiers: [],
              availabilityNux: null,
              model: "gpt-5",
              displayName: "GPT-5",
              description: "GPT-5 model",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced reasoning" },
              ],
              defaultReasoningEffort: "medium",
              defaultServiceTier: null,
              inputModalities: ["text"],
              modelSpecialty: null,
              multiAgentVersion: null,
              serviceTiers: [],
              supportsPersonality: true,
              isDefault: true,
              upgrade: null,
              upgradeInfo: null,
            },
          ],
          nextCursor: null,
        });
      }
      if (input.method === "thread/start") {
        return Effect.succeed({
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
            excludeSlashTmp: false,
            excludeTmpdirEnvVar: false,
            networkAccess: false,
            writableRoots: ["/repo"],
          },
          serviceTier: null,
          thread,
        });
      }
      if (input.method === "thread/read") return Effect.succeed({ thread });
      if (input.method === "thread/name/set") return Effect.succeed({});
      if (input.method === "thread/turns/list") {
        return Effect.succeed({ data: [], nextCursor: null, backwardsCursor: null });
      }
      return Effect.dieMessage(`Unexpected native request ${input.method}`);
    },
    respond: () => Effect.succeed(undefined),
  });
  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: {
      requireRepoRuntime: async () => ({
        kind: "codex",
        runtimeId,
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "stdio", identity: runtimeId },
        startedAt: "2026-05-07T00:00:00.000Z",
        descriptor: CODEX_RUNTIME_DESCRIPTOR,
      }),
    },
    transportFactory: () => createCodexRuntimeTransport(registry, runtimeId),
    subscribeEvents: () => () => {},
    respondServerRequest: async () => {},
    onRuntimeEventQueueFailure: () => undefined,
  });

  await adapter.startSession({
    ...ref,
    systemPrompt: "Use the repo rules.",
    model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
  });
  await expect(adapter.loadSessionHistory(ref)).resolves.toEqual([
    expect.objectContaining({ role: "system" }),
  ]);
  await expect(adapter.loadSessionTodos(ref)).resolves.toEqual([]);
  expect(nativeMethods.filter((method) => method === "thread/read")).toHaveLength(2);

  turnsFail = false;
  await adapter.loadSessionHistory(ref);
  turnsFail = true;
  const failure = await adapter.loadSessionHistory(ref).catch((cause) => cause);
  expect(failure).toBeInstanceOf(CodexSessionHistoryError);
  expect(failure.cause).toBe(rawError);
  expect(failure.failure).toMatchObject({
    code: "request_failed",
    method: "thread/turns/list",
    diagnosticId: expect.any(String),
  });
});
