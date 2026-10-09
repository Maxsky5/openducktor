import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  DEFAULT_CODEX_RUNTIME_POLICY,
  type AgentSessionControlSendInput,
  type CodexEffectivePolicy,
  type CodexAppServerTurnStartResult,
  type CodexAppServerTurnSteerResult,
  type RuntimeInstanceSummary,
  RUNTIME_DESCRIPTORS_BY_KIND,
  parseCodexAppServerRequestResult,
} from "@openducktor/contracts";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { HostOperationError } from "../../effect/host-errors";
import {
  AgentSessionMessageAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../ports/agent-session-send-error";
import { createCodexLiveSessionAdapterPreparer } from "./codex-live-session-adapter";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const turnResult = (
  status: "inProgress" | "failed" = "inProgress",
): CodexAppServerTurnStartResult =>
  parseCodexAppServerRequestResult("turn/start", {
    turn: {
      id: "turn-admitted",
      status,
      items: [],
      itemsView: "full",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      error:
        status === "failed"
          ? { message: "Exact native turn failure", codexErrorInfo: null, additionalDetails: null }
          : null,
    },
  });
const harness = async () => {
  const runtime: RuntimeInstanceSummary = {
    runtimeId: "runtime-live",
    kind: "codex",
    runtimeRoute: { type: "stdio", identity: "runtime-live" },
    startedAt: "2026-10-04T00:00:00Z",
    descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
  };
  const calls: string[] = [];
  const transport = {
    calls,
    turnStartDeferred: deferred<CodexAppServerTurnStartResult>(),
    entered: deferred<void>(),
    steerDeferred: deferred<CodexAppServerTurnSteerResult>(),
    steerEntered: deferred<void>(),
  };
  let failPublication = false;
  let modelFailure: "fetch" | "removed" | undefined;
  const policy: CodexEffectivePolicy = {
    ...DEFAULT_CODEX_RUNTIME_POLICY,
    approvalsReviewerApplies: true,
  };
  const prepared = await Effect.runPromise(
    createCodexLiveSessionAdapterPreparer({
      resolveMcpServerConfig: () =>
        Effect.succeed({
          command: ["bun"],
          environment: {
            ODT_WORKSPACE_ID: "workspace",
            ODT_HOST_URL: "http://127.0.0.1:5000",
            ODT_HOST_TOKEN: "test-token",
            ODT_FORBID_WORKSPACE_ID_INPUT: "true",
            ODT_ALLOWED_TOOLS: "",
          },
        }),
      liveSessionLifecycle: {
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            mutation.pipe(
              Effect.flatMap((result) =>
                failPublication
                  ? Effect.fail(
                      new HostOperationError({
                        operation: "publish",
                        message: "Exact publication failure",
                      }),
                    )
                  : Effect.succeed(result.value),
              ),
            ),
          ),
      },
      codexAppServer: {
        request: (input) => {
          transport.calls.push(input.method);
          switch (input.method) {
            case "thread/name/set":
              return Effect.succeed(parseCodexAppServerRequestResult("thread/name/set", {}));
            case "initialize":
              return Effect.succeed(
                parseCodexAppServerRequestResult("initialize", {
                  codexHome: "/tmp/codex",
                  platformFamily: "unix",
                  platformOs: "linux",
                  userAgent: "codex_cli_rs/0.149.0-test",
                }),
              );
            case "model/list":
              if (modelFailure === "fetch")
                return Effect.fail(
                  new HostOperationError({ operation: "model/list", message: "Model list failed" }),
                );
              if (modelFailure === "removed")
                return Effect.succeed(
                  parseCodexAppServerRequestResult("model/list", { data: [], nextCursor: null }),
                );
              return Effect.succeed(
                parseCodexAppServerRequestResult("model/list", {
                  data: [
                    {
                      id: "gpt-5",
                      model: "gpt-5",
                      displayName: "GPT-5",
                      description: "Model",
                      hidden: false,
                      isDefault: true,
                      supportedReasoningEfforts: [
                        { reasoningEffort: "medium", description: "Balanced" },
                      ],
                      defaultReasoningEffort: "medium",
                      inputModalities: ["text"],
                      supportsPersonality: true,
                      additionalSpeedTiers: [],
                      availabilityNux: null,
                      defaultServiceTier: null,
                      modelSpecialty: null,
                      multiAgentVersion: null,
                      serviceTiers: [],
                      upgrade: null,
                      upgradeInfo: null,
                    },
                  ],
                  nextCursor: null,
                }),
              );
            case "thread/start":
              return Effect.succeed(
                parseCodexAppServerRequestResult("thread/start", {
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
                  serviceTier: null,
                  sandbox: {
                    type: "workspaceWrite",
                    excludeSlashTmp: false,
                    excludeTmpdirEnvVar: false,
                    networkAccess: false,
                    writableRoots: ["/repo"],
                  },
                  thread: {
                    id: "thread-saved",
                    extra: null,
                    sessionId: "thread-saved",
                    forkedFromId: null,
                    parentThreadId: null,
                    preview: "Task",
                    ephemeral: false,
                    section: null,
                    sectionEnteredAt: null,
                    projectId: null,
                    historyMode: "paginated",
                    modelProvider: "openai",
                    model: "gpt-5",
                    reasoningEffort: "medium",
                    createdAt: 1,
                    updatedAt: 1,
                    recencyAt: 1,
                    status: { type: "idle" },
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
                }),
              );
            case "turn/start":
              transport.entered.resolve();
              return Effect.tryPromise({
                try: () => transport.turnStartDeferred.promise,
                catch: (cause) =>
                  cause instanceof HostOperationError
                    ? cause
                    : new HostOperationError({
                        operation: "native",
                        message: String(cause),
                        cause,
                      }),
              });
            case "turn/steer":
              transport.steerEntered.resolve();
              return Effect.tryPromise({
                try: () => transport.steerDeferred.promise,
                catch: (cause) =>
                  cause instanceof HostOperationError
                    ? cause
                    : new HostOperationError({
                        operation: "native",
                        message: String(cause),
                        cause,
                      }),
              });
            default:
              return Effect.die(new Error(`Unexpected native request ${input.method}`));
          }
        },
        listThreadTurns: () => Effect.die(new Error("Unexpected history read")),
        listLoadedThreads: () => Effect.die(new Error("Unexpected thread discovery")),
        listThreads: () => Effect.die(new Error("Unexpected thread discovery")),
        respond: () => Effect.die(new Error("Unexpected native response")),
      },
      prepareImageGenerations: async () => {
        throw new Error("Unexpected image preparation");
      },
      onBackgroundFailure: () => Effect.void,
      resolveRuntimePolicy: () => Effect.succeed(policy),
    })(runtime),
  );
  const session = await Effect.runPromise(
    prepared.adapter.startSession({
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionScope: { kind: "workflow", taskId: "task", role: "build" },
      systemPrompt: "Build the requested task.",
      model: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5", variant: "medium" },
    }),
  );
  const input: AgentSessionControlSendInput = {
    ...session,
    repoPath: "/repo",
    sessionScope: { kind: "workflow", taskId: "task", role: "build" },
    parts: [{ kind: "text", text: "First instruction" }],
  };
  return {
    prepared,
    transport,
    input,
    failModel: (failure: "fetch" | "removed") => {
      modelFailure = failure;
    },
    failPublication: () => {
      failPublication = true;
    },
  };
};

test.each(["fetch", "removed"] as const)(
  "Codex model preflight preserves rejection before submission: %s",
  async (failure) => {
    const h = await harness();
    h.failModel(failure);
    const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    try {
      const result = await Effect.runPromise(
        h.prepared.adapter.sendUserMessage(h.input).pipe(Effect.result),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected the model check to fail.");
      expect(result.failure).toBeInstanceOf(AgentSessionMessageRejectedError);
      expect(result.failure.message).toContain(
        failure === "fetch" ? "Model list failed" : "was not found",
      );
      expect(
        h.transport.calls.filter((method) => method === "turn/start" || method === "turn/steer"),
      ).toEqual([]);
    } finally {
      clock.mockRestore();
      await Effect.runPromise(h.prepared.adapter.releaseRuntime());
    }
  },
);

test.each(["accepted", "rejected", "unknown", "publication_failed", "turn_failed"] as const)(
  "host Codex send waits for native admission and retains %s evidence",
  async (outcome) => {
    const h = await harness();
    let settled = false;
    const send = Effect.runPromiseExit(h.prepared.adapter.sendUserMessage(h.input)).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    try {
      await h.transport.entered.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.transport.calls.filter((call) => call === "turn/start")).toHaveLength(1);
      expect(settled).toBe(false);
      if (outcome === "rejected") {
        h.transport.turnStartDeferred.reject(
          new HostOperationError({
            operation: "codexAppServerTransport.request.turn/start",
            message: "Exact native rejection",
            cause: { code: -32600, message: "Exact native rejection" },
            details: { method: "turn/start", runtimeId: "runtime-live" },
          }),
        );
      } else if (outcome === "unknown") {
        h.transport.turnStartDeferred.reject(new Error("Exact transport disconnect"));
      } else {
        if (outcome === "publication_failed") h.failPublication();
        h.transport.turnStartDeferred.resolve(
          turnResult(outcome === "turn_failed" ? "failed" : "inProgress"),
        );
      }
      const result = await send;
      if (outcome === "accepted") {
        expect(result).toMatchObject({
          _tag: "Success",
          value: { type: "user_message", message: "First instruction" },
        });
      } else {
        expect(result._tag).toBe("Failure");
        if (result._tag !== "Failure") throw new Error("Expected a failed send");
        const cause = await Effect.runPromise(Effect.flip(Effect.failCause(result.cause)));
        if (outcome === "rejected") expect(cause).toBeInstanceOf(AgentSessionMessageRejectedError);
        else if (outcome === "publication_failed" || outcome === "turn_failed") {
          expect(cause).toBeInstanceOf(AgentSessionMessageAcceptedError);
          expect(cause).toHaveProperty("failure.acceptedMessage.message", "First instruction");
        } else {
          expect(cause).not.toBeInstanceOf(AgentSessionMessageRejectedError);
          expect(cause).not.toBeInstanceOf(AgentSessionMessageAcceptedError);
        }
        expect(cause.message).toContain(
          outcome === "rejected"
            ? "Exact native rejection"
            : outcome === "unknown"
              ? "Exact transport disconnect"
              : outcome === "turn_failed"
                ? "Exact native turn failure"
                : "Exact publication failure",
        );
      }
    } finally {
      h.transport.turnStartDeferred.resolve(turnResult());
      await send;
      await Effect.runPromise(h.prepared.adapter.releaseRuntime());
    }
  },
);

test.each(["accepted", "rejected"] as const)(
  "host Codex steer retains %s evidence when the runtime owner is released during admission",
  async (outcome) => {
    const h = await harness();
    h.transport.turnStartDeferred.resolve(turnResult());
    await Effect.runPromise(h.prepared.adapter.sendUserMessage(h.input));
    const send = Effect.runPromiseExit(
      h.prepared.adapter.sendUserMessage({
        ...h.input,
        parts: [{ kind: "text", text: "Reuse instruction" }],
      }),
    );
    try {
      await h.transport.steerEntered.promise;
      await Effect.runPromise(h.prepared.adapter.releaseRuntime());
      if (outcome === "accepted")
        h.transport.steerDeferred.resolve(
          parseCodexAppServerRequestResult("turn/steer", { turnId: "turn-admitted" }),
        );
      else
        h.transport.steerDeferred.reject(
          new HostOperationError({
            operation: "codexAppServerTransport.request.turn/steer",
            message: "Exact native steer rejection",
            cause: { code: -32600, message: "Exact native steer rejection" },
            details: { method: "turn/steer", runtimeId: "runtime-live" },
          }),
        );
      const result = await send;
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected a failed steer");
      const cause = await Effect.runPromise(Effect.flip(Effect.failCause(result.cause)));
      if (outcome === "accepted") {
        expect(cause).toBeInstanceOf(AgentSessionMessageAcceptedError);
        expect(cause).toHaveProperty("failure.acceptedMessage.message", "Reuse instruction");
        expect(cause.message).toContain("retained owner was released or replaced");
      } else {
        expect(cause).toBeInstanceOf(AgentSessionMessageRejectedError);
        expect(cause.message).toBe("Exact native steer rejection");
      }
      expect(h.transport.calls.filter((call) => call === "turn/steer")).toHaveLength(1);
    } finally {
      h.transport.steerDeferred.resolve(
        parseCodexAppServerRequestResult("turn/steer", { turnId: "turn-admitted" }),
      );
      await send;
      await Effect.runPromise(h.prepared.adapter.releaseRuntime());
    }
  },
);
