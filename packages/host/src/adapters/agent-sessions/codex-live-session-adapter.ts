import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions,
  type CodexJsonRpcRequest,
  type CodexLiveSessionMutation,
} from "@openducktor/adapters-codex-app-server";
import {
  type AgentSessionControlSummary,
  type AgentSessionLiveRef,
  type AgentSessionScope,
  acceptedAgentUserMessageSchema,
  agentSessionControlSummarySchema,
  agentSessionLiveLoadContextResultSchema,
  type CodexEffectivePolicy,
  jsonValueSchema,
  parseCodexAppServerClientRequest,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import {
  type HostError,
  type HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  CodexAppServerPort,
  CodexAppServerRespondInput,
  CodexAppServerStreamEvent,
} from "../../ports/codex-app-server-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import { stopCodexSession } from "../codex/codex-session-stop";
import { createCodexLiveSessionEventHub } from "./codex-live-session-event-hub";
import { toCodexUserMessagePart } from "./codex-live-session-inputs";
import { createCodexLiveSessionProjection } from "./codex-live-session-projection";

type CodexSessionController = Pick<
  CodexAppServerAdapter,
  | "prepareRuntime"
  | "listLiveSessionSnapshots"
  | "loadLiveSessionContextUsage"
  | "loadSessionContextUsage"
  | "loadSessionDiff"
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
    scope: AgentSessionScope,
  ) => Effect.Effect<CodexEffectivePolicy, HostError>;
  readonly createController?: (options: CodexAppServerAdapterOptions) => CodexSessionController;
};

const toSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
  externalSessionId: ref.externalSessionId,
});

const parseOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError> =>
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
  // SAFETY: The runtime adapter builds this value from the contract fields required by `CodexRuntimeInstance`.
  return Effect.succeed(runtime as CodexRuntimeInstance);
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
      const eventHub = createCodexLiveSessionEventHub(runtime.runtimeId);
      const projection = createCodexLiveSessionProjection({
        runtime,
        liveSessionLifecycle,
      });

      // SAFETY: The schema parser validates every field required by `CodexAppServerRespondInput` before returning.
      const controller = yield* Effect.try({
        try: () =>
          createController({
            repoRuntimeResolver: {
              requireRepoRuntime: async () => runtime,
            },
            transportFactory: (runtimeId) => ({
              request: async (request: CodexJsonRpcRequest) => {
                const parsedRequest = parseCodexAppServerClientRequest(
                  jsonValueSchema.parse(request),
                );
                return jsonValueSchema.parse(
                  await Effect.runPromise(
                    codexAppServer.request({
                      runtimeId,
                      ...parsedRequest,
                    }),
                  ),
                );
              },
            }),
            subscribeEvents: (runtimeId, listener) => eventHub.subscribe(runtimeId, listener),
            respondServerRequest: (runtimeId, requestId, result, error) => {
              const response: CodexAppServerRespondInput = { runtimeId, requestId };
              if (result !== undefined) Object.assign(response, { result });
              if (error !== undefined) Object.assign(response, { error });
              return Effect.runPromise(codexAppServer.respond(response));
            },
            onRuntimeEventQueueFailure: ({ runtimeId, error }) => {
              Effect.runFork(
                onBackgroundFailure(
                  toHostOperationError(error, "codex-live-session.forward-mutation", {
                    runtimeId,
                  }),
                ),
              );
              return undefined;
            },
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
        run: () => Promise<AgentSessionControlSummary>,
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
          readonly sessionScope?: AgentSessionScope;
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
        const sessionScope = input.sessionScope;
        if (!sessionScope) {
          return Effect.fail(
            new HostValidationError({
              field: "sessionScope",
              message: `Codex live-session control '${operation}' requires session scope.`,
              details: { operation, runtimeId: runtime.runtimeId },
            }),
          );
        }
        return resolveRuntimePolicy(sessionScope).pipe(
          Effect.map((policy) => ({
            ...input,
            runtimeKind: "codex" as const,
            sessionScope,
            runtimePolicy: { kind: "codex" as const, policy },
          })),
        );
      };

      const sessionError = (operation: string, externalSessionId: string) => (cause: unknown) =>
        toHostOperationError(cause, operation, {
          runtimeId: runtime.runtimeId,
          externalSessionId,
        });

      // SAFETY: The runtime adapter builds this value from the contract fields required by the asserted shape.
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
                          "Loading an unloaded Codex session context requires session scope.",
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
        loadSessionDiff: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.loadSessionDiff({
                repoPath: input.repoPath,
                runtimeKind: input.runtimeKind,
                workingDirectory: input.workingDirectory,
                externalSessionId: input.externalSessionId,
                ...(input.runtimeHistoryAnchor !== undefined
                  ? { runtimeHistoryAnchor: input.runtimeHistoryAnchor }
                  : undefined),
              }),
            catch: sessionError("codex-live-session.load-diff", input.externalSessionId),
          }),
        replyApproval: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.replyLiveApproval({
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
                outcome: input.outcome,
                ...(input.message !== undefined ? { message: input.message } : undefined),
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
            Effect.flatMap((boundInput) => {
              const { model, ...requiredInput } = boundInput;
              return runControlSummary("codex-live-session.start-session", () =>
                controller.startSession({
                  ...requiredInput,
                  ...(model !== undefined ? { model } : undefined),
                }),
              );
            }),
          ),
        resumeSession: (input) =>
          bindControlPolicy(input, "resume-session").pipe(
            Effect.flatMap((boundInput) => {
              const { model, systemPrompt, ...requiredInput } = boundInput;
              return runControlSummary("codex-live-session.resume-session", () =>
                controller.resumeSession({
                  ...requiredInput,
                  ...(model !== undefined ? { model } : undefined),
                  ...(systemPrompt !== undefined ? { systemPrompt } : undefined),
                }),
              );
            }),
          ),
        forkSession: (input) =>
          bindControlPolicy(input, "fork-session").pipe(
            Effect.flatMap((boundInput) => {
              const { model, runtimeHistoryAnchor, ...requiredInput } = boundInput;
              return runControlSummary("codex-live-session.fork-session", () =>
                controller.forkSession({
                  ...requiredInput,
                  ...(model !== undefined ? { model } : undefined),
                  ...(runtimeHistoryAnchor !== undefined ? { runtimeHistoryAnchor } : undefined),
                }),
              );
            }),
          ),
        sendUserMessage: (input) =>
          bindControlPolicy(input, "send-user-message").pipe(
            Effect.flatMap((boundInput) => {
              const { model, parts, systemPrompt, ...requiredInput } = boundInput;
              return Effect.tryPromise({
                try: () =>
                  controller.sendUserMessage({
                    ...requiredInput,
                    parts: parts.map(toCodexUserMessagePart),
                    ...(model !== undefined ? { model } : undefined),
                    ...(systemPrompt !== undefined ? { systemPrompt } : undefined),
                  }),
                catch: sessionError(
                  "codex-live-session.send-user-message",
                  input.externalSessionId,
                ),
              });
            }),
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
            try: () => controller.updateSessionModel(input),
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
