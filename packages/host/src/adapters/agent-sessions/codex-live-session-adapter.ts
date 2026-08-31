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
  agentSessionLiveLoadContextResultSchema,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type { AgentRuntimePolicyBinding, AgentSessionSummary } from "@openducktor/core";
import { Effect } from "effect";
import type { z } from "zod";
import { toAgentSessionControlMetadata } from "../../application/agent-sessions/agent-session-control-metadata";
import {
  type HostError,
  type HostOperationErrorAggregate,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { CodexAppServerRespondInput } from "../../ports/codex-app-server-port";
import { stopCodexSession } from "../codex/codex-session-stop";
import type {
  CodexLiveSessionAdapterPreparer,
  CodexSessionController,
  CreateCodexLiveSessionAdapterPreparerInput,
  PreparedCodexLiveSessionAdapter,
} from "./codex-live-session-adapter-contract";
import { createCodexLiveSessionEventHub } from "./codex-live-session-event-hub";
import { toCodexUserMessagePart } from "./codex-live-session-inputs";
import { createCodexLiveSessionProjection } from "./codex-live-session-projection";

type CodexRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "codex";
  readonly runtimeRoute: { readonly type: "stdio"; readonly identity: string };
};

type CodexRuntimeValidationDetails =
  | { readonly runtimeId: string; readonly runtimeKind: RuntimeInstanceSummary["kind"] }
  | { readonly runtimeId: string };

type OperationValidationDetails = { readonly operation: string };

const isCodexRuntimeInstance = (runtime: RuntimeInstanceSummary): runtime is CodexRuntimeInstance =>
  runtime.kind === "codex" && runtime.runtimeRoute.type === "stdio";
export type {
  CodexLiveSessionAdapterPreparer,
  CreateCodexLiveSessionAdapterPreparerInput,
  PreparedCodexLiveSessionAdapter,
} from "./codex-live-session-adapter-contract";

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
): Effect.Effect<z.output<Schema>, HostValidationError<OperationValidationDetails>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError<OperationValidationDetails>({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

const requireRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<CodexRuntimeInstance, HostValidationError<CodexRuntimeValidationDetails>> => {
  if (!isCodexRuntimeInstance(runtime)) {
    return Effect.fail(
      new HostValidationError<CodexRuntimeValidationDetails>({
        field: "runtime",
        message: `Codex live-session adapter requires a Codex stdio runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError<CodexRuntimeValidationDetails>({
        field: "runtime.runtimeRoute.identity",
        message: `Codex runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed(runtime);
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

      const controller = yield* Effect.try({
        try: () =>
          createController({
            repoRuntimeResolver: {
              requireRepoRuntime: async () => runtime,
            },
            transportFactory: (runtimeId) => ({
              request: (request: CodexJsonRpcRequest) =>
                Effect.runPromise(codexAppServer.request({ runtimeId, ...request })),
            }),
            subscribeEvents: (runtimeId, listener) => eventHub.subscribe(runtimeId, listener),
            respondServerRequest: (runtimeId, requestId, result, error) => {
              const response: CodexAppServerRespondInput = { runtimeId, requestId };
              if (result !== undefined) {
                response.result = result;
              }
              if (error !== undefined) {
                response.error = error;
              }
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
        run: () => Promise<AgentSessionSummary>,
      ): Effect.Effect<AgentSessionControlSummary, HostError> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) =>
            toHostOperationError(cause, operation, { runtimeId: runtime.runtimeId }),
        }).pipe(
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
          Effect.flatMap((summary) => toAgentSessionControlMetadata(summary, operation)),
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
          Effect.map((policy) => {
            const binding: Extract<AgentRuntimePolicyBinding, { runtimeKind: "codex" }> = {
              runtimeKind: "codex",
              runtimePolicy: { kind: "codex", policy },
            };
            return { ...input, ...binding, sessionScope };
          }),
        );
      };

      const sessionError =
        (operation: string, externalSessionId: string) =>
        (cause: unknown): HostOperationErrorAggregate =>
          toHostOperationError(cause, operation, {
            runtimeId: runtime.runtimeId,
            externalSessionId,
          });

      const adapter: AgentSessionRuntimeAdapterPort = {
        supportsSessionControl: true,
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
        loadSessionDiff: (input) => {
          const request: Parameters<typeof controller.loadSessionDiff>[0] = {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          };
          if (input.runtimeHistoryAnchor !== undefined) {
            request.runtimeHistoryAnchor = input.runtimeHistoryAnchor;
          }
          return Effect.tryPromise({
            try: () => controller.loadSessionDiff(request),
            catch: sessionError("codex-live-session.load-diff", input.externalSessionId),
          });
        },
        replyApproval: (input) => {
          const request: Parameters<typeof controller.replyLiveApproval>[0] = {
            runtimeId: runtime.runtimeId,
            externalSessionId: input.externalSessionId,
            requestId: input.requestId,
            outcome: input.outcome,
          };
          if (input.message !== undefined) {
            request.message = input.message;
          }
          return Effect.tryPromise({
            try: () => controller.replyLiveApproval(request),
            catch: sessionError("codex-live-session.reply-approval", input.externalSessionId),
          }).pipe(Effect.tap(() => refreshProjection()));
        },
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
              const request: Parameters<typeof controller.startSession>[0] = requiredInput;
              if (model !== undefined) {
                request.model = model;
              }
              return runControlSummary("codex-live-session.start-session", () =>
                controller.startSession(request),
              );
            }),
          ),
        resumeSession: (input) =>
          bindControlPolicy(input, "resume-session").pipe(
            Effect.flatMap((boundInput) => {
              const { model, systemPrompt, ...requiredInput } = boundInput;
              const request: Parameters<typeof controller.resumeSession>[0] = requiredInput;
              if (model !== undefined) {
                request.model = model;
              }
              if (systemPrompt !== undefined) {
                request.systemPrompt = systemPrompt;
              }
              return runControlSummary("codex-live-session.resume-session", () =>
                controller.resumeSession(request),
              );
            }),
          ),
        forkSession: (input) =>
          bindControlPolicy(input, "fork-session").pipe(
            Effect.flatMap((boundInput) => {
              const { model, runtimeHistoryAnchor, ...requiredInput } = boundInput;
              const request: Parameters<typeof controller.forkSession>[0] = requiredInput;
              if (model !== undefined) {
                request.model = model;
              }
              if (runtimeHistoryAnchor !== undefined) {
                request.runtimeHistoryAnchor = runtimeHistoryAnchor;
              }
              return runControlSummary("codex-live-session.fork-session", () =>
                controller.forkSession(request),
              );
            }),
          ),
        sendUserMessage: (input) =>
          bindControlPolicy(input, "send-user-message").pipe(
            Effect.flatMap((boundInput) => {
              const { model, parts, systemPrompt, ...requiredInput } = boundInput;
              const request: Parameters<typeof controller.sendUserMessage>[0] = {
                ...requiredInput,
                parts: parts.map(toCodexUserMessagePart),
              };
              if (model !== undefined) {
                request.model = model;
              }
              if (systemPrompt !== undefined) {
                request.systemPrompt = systemPrompt;
              }
              return Effect.tryPromise({
                try: () => controller.sendUserMessage(request),
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
