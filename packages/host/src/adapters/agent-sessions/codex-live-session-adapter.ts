import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions,
  type CodexJsonRpcRequest,
  type CodexLiveSessionMutation,
} from "@openducktor/adapters-codex-app-server";
import {
  type AgentSessionControlSummary,
  type AgentSessionLiveRef,
  type AgentSessionWorkflowScope,
  acceptedAgentUserMessageSchema,
  agentSessionControlSummarySchema,
  agentSessionLiveLoadContextResultSchema,
  type CodexEffectivePolicy,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  type HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  CodexAppServerPort,
  CodexAppServerRequestInput,
  CodexAppServerRespondInput,
  CodexAppServerStreamEvent,
} from "../../ports/codex-app-server-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import { stopCodexSession } from "../codex/codex-session-stop";
import { createCodexLiveSessionProjection } from "./codex-live-session-projection";

type CodexSessionController = Pick<
  CodexAppServerAdapter,
  | "prepareRuntime"
  | "listLiveSessionSnapshots"
  | "loadLiveSessionContextUsage"
  | "loadSessionContextUsage"
  | "replyLiveApproval"
  | "replyLiveQuestion"
  | "releaseRuntime"
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "sendUserMessage"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
>;

type CodexRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "codex";
  readonly runtimeRoute: { readonly type: "stdio"; readonly identity: string };
};

export type PreparedCodexLiveSessionAdapter = Omit<PreparedRuntimeLiveSessionAdapter, "adapter"> & {
  readonly adapter: AgentSessionRuntimeAdapterPort;
  readonly emitRuntimeEvent: (event: CodexAppServerStreamEvent) => void;
};

export type CodexLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedCodexLiveSessionAdapter, HostError>;

export type CreateCodexLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation">;
  readonly codexAppServer: CodexAppServerPort;
  readonly onBackgroundFailure: (failure: HostOperationError) => Effect.Effect<void, never>;
  readonly resolveRuntimePolicy: (
    scope: AgentSessionWorkflowScope,
  ) => Effect.Effect<CodexEffectivePolicy, HostError>;
  readonly createController?: (options: CodexAppServerAdapterOptions) => CodexSessionController;
};

const toSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
  externalSessionId: ref.externalSessionId,
});

const parseOutput = <Output>(
  schema: { parse(value: unknown): Output },
  value: unknown,
  operation: string,
): Effect.Effect<Output, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

const requireRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<CodexRuntimeInstance, HostValidationError> => {
  if (runtime.kind !== "codex" || runtime.runtimeRoute.type !== "stdio") {
    return Effect.fail(
      new HostValidationError({
        field: "runtime",
        message: `Codex live-session adapter requires a Codex stdio runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError({
        field: "runtime.runtimeRoute.identity",
        message: `Codex runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed(runtime as CodexRuntimeInstance);
};

const createEventHub = (runtimeId: string) => {
  let listener: ((event: CodexAppServerStreamEvent) => void) | null = null;
  return {
    subscribe(
      subscribedRuntimeId: string,
      nextListener: (event: CodexAppServerStreamEvent) => void,
    ): () => void {
      if (subscribedRuntimeId !== runtimeId) {
        throw new Error(
          `Cannot subscribe Codex runtime '${subscribedRuntimeId}' through event hub '${runtimeId}'.`,
        );
      }
      if (listener) {
        throw new Error(`Codex runtime '${runtimeId}' already has a live event subscriber.`);
      }
      listener = nextListener;
      return () => {
        if (listener === nextListener) {
          listener = null;
        }
      };
    },
    emit(event: CodexAppServerStreamEvent): void {
      if (event.runtimeId !== runtimeId) {
        throw new Error(
          `Codex event for runtime '${event.runtimeId}' cannot enter event hub '${runtimeId}'.`,
        );
      }
      if (!listener) {
        throw new Error(
          `Codex runtime '${runtimeId}' emitted an event before observation was prepared.`,
        );
      }
      listener(event);
    },
  };
};

const defaultCreateController = (options: CodexAppServerAdapterOptions): CodexSessionController =>
  new CodexAppServerAdapter(options);

export const createCodexLiveSessionAdapterPreparer =
  ({
    liveSessionLifecycle,
    codexAppServer,
    onBackgroundFailure,
    resolveRuntimePolicy,
    createController = defaultCreateController,
  }: CreateCodexLiveSessionAdapterPreparerInput): CodexLiveSessionAdapterPreparer =>
  (runtimeInput) =>
    Effect.gen(function* () {
      const runtime = yield* requireRuntime(runtimeInput);
      const eventHub = createEventHub(runtime.runtimeId);
      const projection = createCodexLiveSessionProjection({
        runtime,
        liveSessionLifecycle,
      });

      const controller = yield* Effect.try({
        try: () =>
          createController({
            repoRuntimeResolver: {
              requireRepoRuntime: async () => runtime,
            },
            transportFactory: (runtimeId) => ({
              request: <Response>(request: CodexJsonRpcRequest): Promise<Response> =>
                Effect.runPromise(
                  codexAppServer.request({
                    runtimeId,
                    ...request,
                  } as CodexAppServerRequestInput),
                ) as Promise<Response>,
            }),
            subscribeEvents: (runtimeId, listener) => eventHub.subscribe(runtimeId, listener),
            respondServerRequest: (runtimeId, requestId, result, error) =>
              Effect.runPromise(
                codexAppServer.respond({
                  runtimeId,
                  requestId,
                  ...(result !== undefined ? { result } : {}),
                  ...(error !== undefined ? { error } : {}),
                } as CodexAppServerRespondInput),
              ),
            onRuntimeEventQueueFailure: ({ runtimeId, error }) =>
              Effect.runPromise(
                onBackgroundFailure(
                  toHostOperationError(error, "codex-live-session.forward-mutation", {
                    runtimeId,
                  }),
                ),
              ),
            onLiveSessionMutation: projection.enqueueMutation,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "codex-live-session.create-controller", {
            runtimeId: runtime.runtimeId,
          }),
      });

      yield* Effect.tryPromise({
        try: () => controller.prepareRuntime(runtime.runtimeId),
        catch: (cause) =>
          toHostOperationError(cause, "codex-live-session.prepare-runtime", {
            runtimeId: runtime.runtimeId,
          }),
      });

      const refreshProjection = (
        transcriptEvents: CodexLiveSessionMutation["transcriptEvents"] = [],
      ): Effect.Effect<void, HostError> =>
        projection.applyMutation({
          runtimeId: runtime.runtimeId,
          snapshots: controller.listLiveSessionSnapshots(runtime.runtimeId),
          transcriptEvents,
          catalogInvalidated: false,
        });

      const runControlSummary = (
        operation: string,
        run: () => Promise<unknown>,
      ): Effect.Effect<AgentSessionControlSummary, HostError> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) =>
            toHostOperationError(cause, operation, { runtimeId: runtime.runtimeId }),
        }).pipe(
          Effect.flatMap((summary) =>
            parseOutput(agentSessionControlSummarySchema, summary, `${operation}.normalize`),
          ),
          Effect.flatMap((summary) =>
            summary.runtimeKind === "codex"
              ? refreshProjection().pipe(Effect.as(summary))
              : Effect.fail(
                  new HostValidationError({
                    field: "runtimeKind",
                    message: `Codex control '${operation}' returned runtime kind '${summary.runtimeKind}'.`,
                    details: { runtimeId: runtime.runtimeId },
                  }),
                ),
          ),
        );

      const releaseRuntime = (): Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError> =>
        projection.releaseRuntime(() => controller.releaseRuntime(runtime.runtimeId));

      const bindControlPolicy = <
        Input extends {
          readonly runtimeKind: string;
          readonly sessionScope?: AgentSessionWorkflowScope;
        },
      >(
        input: Input,
        operation: string,
      ) => {
        if (input.runtimeKind !== "codex") {
          return Effect.fail(
            new HostValidationError({
              field: "runtimeKind",
              message: `Codex live-session control '${operation}' requires a Codex runtime.`,
              details: { operation, runtimeKind: input.runtimeKind },
            }),
          );
        }
        if (!input.sessionScope) {
          return Effect.fail(
            new HostValidationError({
              field: "sessionScope",
              message: `Codex live-session control '${operation}' requires workflow session scope.`,
              details: { operation, runtimeKind: input.runtimeKind },
            }),
          );
        }
        return resolveRuntimePolicy(input.sessionScope).pipe(
          Effect.map((policy) => ({
            ...input,
            runtimePolicy: { kind: "codex" as const, policy },
          })),
        );
      };

      const sessionError = (operation: string, externalSessionId: string) => (cause: unknown) =>
        toHostOperationError(cause, operation, {
          runtimeId: runtime.runtimeId,
          externalSessionId,
        });

      const adapter: AgentSessionRuntimeAdapterPort = {
        binding: {
          runtimeId: runtime.runtimeId,
          runtimeKind: "codex",
          repoPath: runtime.repoPath,
        },
        matches: projection.matches,
        listRetainedSnapshots: projection.listRetainedSnapshots,
        readRetainedSnapshot: projection.readRetainedSnapshot,
        loadContext: (input) =>
          Effect.gen(function* () {
            const retained = projection.hasSnapshot(input);
            const usage = retained
              ? yield* Effect.tryPromise({
                  try: () =>
                    controller.loadLiveSessionContextUsage({
                      runtimeId: runtime.runtimeId,
                      externalSessionId: input.externalSessionId,
                    }),
                  catch: sessionError("codex-live-session.load-context", input.externalSessionId),
                })
              : yield* Effect.gen(function* () {
                  const sessionScope = input.sessionScope;
                  if (sessionScope === undefined) {
                    return yield* Effect.fail(
                      new HostValidationError({
                        field: "sessionScope",
                        message:
                          "Loading an unloaded Codex session context requires workflow session scope.",
                        details: {
                          runtimeId: runtime.runtimeId,
                          externalSessionId: input.externalSessionId,
                        },
                      }),
                    );
                  }
                  const policy = yield* resolveRuntimePolicy(sessionScope);
                  return yield* Effect.tryPromise({
                    try: () =>
                      controller.loadSessionContextUsage({
                        repoPath: input.repoPath,
                        runtimeKind: "codex",
                        workingDirectory: input.workingDirectory,
                        externalSessionId: input.externalSessionId,
                        sessionScope,
                        runtimePolicy: { kind: "codex", policy },
                      }),
                    catch: sessionError(
                      "codex-live-session.load-persisted-context",
                      input.externalSessionId,
                    ),
                  });
                });
            const normalized = yield* parseOutput(
              agentSessionLiveLoadContextResultSchema,
              usage,
              "codex-live-session.normalize-context",
            );
            yield* refreshProjection();
            return normalized;
          }),
        replyApproval: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.replyLiveApproval({
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
                outcome: input.outcome,
                ...(input.message !== undefined ? { message: input.message } : {}),
              }),
            catch: sessionError("codex-live-session.reply-approval", input.externalSessionId),
          }).pipe(Effect.tap(() => refreshProjection())),
        replyQuestion: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.replyLiveQuestion({
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
                answers: input.answers,
              }),
            catch: sessionError("codex-live-session.reply-question", input.externalSessionId),
          }).pipe(
            Effect.flatMap((event) =>
              refreshProjection([{ ...event, sessionRef: toSessionRef(input) }]),
            ),
          ),
        releaseRuntime,
        startSession: (input) =>
          bindControlPolicy(input, "start-session").pipe(
            Effect.flatMap((boundInput) =>
              runControlSummary("codex-live-session.start-session", () =>
                controller.startSession(
                  boundInput as Parameters<CodexSessionController["startSession"]>[0],
                ),
              ),
            ),
          ),
        resumeSession: (input) =>
          bindControlPolicy(input, "resume-session").pipe(
            Effect.flatMap((boundInput) =>
              runControlSummary("codex-live-session.resume-session", () =>
                controller.resumeSession(
                  boundInput as Parameters<CodexSessionController["resumeSession"]>[0],
                ),
              ),
            ),
          ),
        forkSession: (input) =>
          bindControlPolicy(input, "fork-session").pipe(
            Effect.flatMap((boundInput) =>
              runControlSummary("codex-live-session.fork-session", () =>
                controller.forkSession(
                  boundInput as Parameters<CodexSessionController["forkSession"]>[0],
                ),
              ),
            ),
          ),
        sendUserMessage: (input) =>
          bindControlPolicy(input, "send-user-message").pipe(
            Effect.flatMap((boundInput) =>
              Effect.tryPromise({
                try: () =>
                  controller.sendUserMessage(
                    boundInput as Parameters<CodexSessionController["sendUserMessage"]>[0],
                  ),
                catch: sessionError(
                  "codex-live-session.send-user-message",
                  input.externalSessionId,
                ),
              }),
            ),
            Effect.flatMap((value) =>
              parseOutput(
                acceptedAgentUserMessageSchema,
                value,
                "codex-live-session.normalize-user-message",
              ).pipe(Effect.as(value)),
            ),
            Effect.flatMap((value) =>
              refreshProjection([{ ...value, sessionRef: toSessionRef(input) }]).pipe(
                Effect.as(value),
              ),
            ),
          ),
        updateSessionModel: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.updateSessionModel({
                ...input,
                ...(input.model ? { model: input.model } : {}),
              } as Parameters<CodexSessionController["updateSessionModel"]>[0]),
            catch: sessionError("codex-live-session.update-session-model", input.externalSessionId),
          }).pipe(Effect.tap(() => refreshProjection())),
        stopSession: (input) =>
          stopCodexSession({
            codexAppServer,
            runtimeId: runtime.runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          }).pipe(
            Effect.flatMap(() =>
              Effect.tryPromise({
                try: () => controller.stopSession(input),
                catch: sessionError("codex-live-session.stop-session", input.externalSessionId),
              }),
            ),
            Effect.tap(() => refreshProjection()),
          ),
        releaseSession: (input) =>
          Effect.tryPromise({
            try: () => controller.releaseSession(input),
            catch: sessionError("codex-live-session.release-session", input.externalSessionId),
          }).pipe(Effect.tap(() => refreshProjection())),
      };

      return {
        adapter,
        emitRuntimeEvent: eventHub.emit,
        startForwarding: projection.startForwarding,
        discard: () => releaseRuntime().pipe(Effect.asVoid),
      } satisfies PreparedCodexLiveSessionAdapter;
    });
