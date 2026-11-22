import { homedir } from "node:os";
import type { ClientConnection, SessionInfo } from "@agentclientprotocol/sdk/unstable";
import {
  ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  agentJsonSchemaInstructions,
  readAgentJsonAnswer,
  type AgentSessionLiveRef,
  type AgentSessionScope,
  type RuntimeInstanceSummary,
  type WorkspaceSessionExternal,
} from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type WorkflowRolePolicyResolver,
  readCatalogSurface,
} from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlSummary } from "../../application/agent-sessions/agent-session-control-summary";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { toAgentSessionSendError } from "../../ports/agent-session-send-error";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import type { AntigravityClientHandlers } from "../antigravity/antigravity-acp-process";
import { AntigravityAgentConnection } from "../antigravity/antigravity-agent-connection";
import { readAntigravityModelCatalog } from "../antigravity/antigravity-models";
import {
  findListedAntigravitySession,
  listAntigravitySessions,
} from "../antigravity/antigravity-native-sessions";
import type { AntigravityRuntimeSessions } from "../antigravity/antigravity-runtime-sessions";
import { AntigravitySessionController } from "../antigravity/antigravity-session-controller";
import { AntigravitySessionRegistry } from "../antigravity/antigravity-session-registry";
import { toAntigravitySkillCatalog } from "../antigravity/antigravity-session-updates";
import { generateAntigravityText } from "../antigravity/antigravity-text-generation";
import type { WorkspaceFileSearch } from "../file-search/workspace-file-search";
import type { OpenDucktorMcpServerConfigResolver } from "../mcp/openducktor-mcp-server-config";
import { toAgentUserMessagePart } from "./agent-user-message-part";
import { createAntigravityLiveSessionProjection } from "./antigravity-live-session-projection";
import {
  unsupportedGeneratedImageOperations,
  unsupportedGeneratedImageSource,
} from "./generated-image-unsupported";
import { toLiveSessionRef } from "./live-session-ref";
import { createEffectRuntimeQueryAdapter } from "./runtime-query-adapter";

type PreparedAntigravityLiveSessionAdapter = Omit<PreparedRuntimeLiveSessionAdapter, "adapter"> & {
  readonly adapter: AgentSessionRuntimeAdapterPort;
  /** The ACP client of the runtime. The starter connects it to the `agy acp` process. */
  readonly acp: {
    readonly handlers: AntigravityClientHandlers;
    readonly attachConnection: (connection: ClientConnection) => void;
  };
};

export type AntigravityLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
  executablePath: string,
) => Effect.Effect<PreparedAntigravityLiveSessionAdapter, HostError>;

export type CreateAntigravityLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "createRuntimeRegistration">;
  readonly resolveMcpServerConfig: OpenDucktorMcpServerConfigResolver;
  readonly resolveWorkflowRolePolicy: WorkflowRolePolicyResolver;
  readonly directoriesMatch: (left: string, right: string) => Effect.Effect<boolean, HostError>;
  readonly attachmentStageDirectory: string;
  readonly createFileSearch: () => WorkspaceFileSearch;
  readonly readEnv: () => NodeJS.ProcessEnv;
  /** The sessions of every running Antigravity runtime of the host. */
  readonly runtimeSessions: AntigravityRuntimeSessions;
};

type AntigravityReattachRequest = AgentSessionLiveRef & {
  readonly sessionScope: AgentSessionScope;
  readonly systemPrompt?: string | undefined;
  readonly model?: AgentModelSelection | undefined;
};

const IMPORT_BATCH_SIZE = 100;

const unsupported = (message: string) =>
  Effect.fail(new HostValidationError({ field: "runtimeKind", message }));

const toImportBatches = (sessions: SessionInfo[]): WorkspaceSessionExternal[][] => {
  const batches: WorkspaceSessionExternal[][] = [];
  for (let index = 0; index < sessions.length; index += IMPORT_BATCH_SIZE) {
    batches.push(
      sessions.slice(index, index + IMPORT_BATCH_SIZE).map((session) => ({
        externalSessionId: session.sessionId,
        runtimeKind: "antigravity",
        workingDirectory: session.cwd,
        title: session.title ?? null,
        updatedAt: session.updatedAt ? Date.parse(session.updatedAt) : null,
      })),
    );
  }
  return batches;
};

/**
 * Exposes the sessions of one shared `agy acp` process as an OpenDucktor live-session adapter.
 * The controller and the sessions own the native protocol. The projection keeps the ordered live
 * state.
 */
export const createAntigravityLiveSessionAdapterPreparer =
  ({
    liveSessionLifecycle,
    resolveMcpServerConfig,
    resolveWorkflowRolePolicy,
    directoriesMatch,
    attachmentStageDirectory,
    createFileSearch,
    readEnv,
    runtimeSessions,
  }: CreateAntigravityLiveSessionAdapterPreparerInput): AntigravityLiveSessionAdapterPreparer =>
  (runtime, executablePath) =>
    Effect.sync(() => {
      const runtimeId = runtime.runtimeId;
      const binding = liveSessionLifecycle.createRuntimeRegistration({
        runtimeId,
        runtimeKind: "antigravity",
      });
      const projection = createAntigravityLiveSessionProjection({ runtimeId, binding });
      const fileSearch = createFileSearch();
      const connection = new AntigravityAgentConnection();
      const sessions = new AntigravitySessionRegistry();
      const controller = new AntigravitySessionController({
        connection,
        sessions,
        attachmentStageDirectory,
        resolveWorkflowRolePolicy,
        publish: projection.publish,
      });
      runtimeSessions.add(runtimeId, { controller, sessions });

      const sessionError =
        (operation: string, ref: Pick<AgentSessionLiveRef, "externalSessionId">) =>
        (cause: unknown) =>
          toHostOperationError(cause, operation, {
            runtimeId,
            externalSessionId: ref.externalSessionId,
          });
      const runtimeError = (operation: string) => (cause: unknown) =>
        toHostOperationError(cause, operation, { runtimeId });

      const run = <Value>(
        operation: string,
        ref: Pick<AgentSessionLiveRef, "externalSessionId">,
        task: () => Promise<Value>,
      ) => Effect.tryPromise({ try: task, catch: sessionError(operation, ref) });

      /**
       * The listed entry of a native session, checked against the saved directory. A session that
       * got no message is not listed, and `session/load` reports a session that does not exist.
       */
      const readNativeSession = (ref: AgentSessionLiveRef, operation: string) =>
        Effect.gen(function* () {
          const entry = yield* run(operation, ref, () =>
            findListedAntigravitySession(connection, ref.externalSessionId),
          );
          if (entry && !(yield* directoriesMatch(entry.cwd, ref.workingDirectory))) {
            return yield* new HostValidationError({
              field: "workingDirectory",
              message: `Antigravity session '${ref.externalSessionId}' belongs to '${entry.cwd}', not '${ref.workingDirectory}'.`,
            });
          }
          return entry;
        });

      /** Opens a saved session in its saved directory. A session that is open stays as it is. */
      const reattach = (input: AntigravityReattachRequest, operation: string) =>
        Effect.gen(function* () {
          const open = sessions.find(input);
          if (open) return open.summary();
          const nativeSession = yield* readNativeSession(input, operation);
          const managedMcpServer = yield* resolveMcpServerConfig(
            input.repoPath,
            input.sessionScope.workspaceId,
          );
          return yield* run(operation, input, () =>
            controller.reattachSession({ ...input, nativeSession, managedMcpServer }),
          );
        });

      // Each live session in a directory uses its file search index.
      const releaseUnusedFileSearch = (workingDirectory: string) =>
        Effect.sync(() => {
          const inUse = sessions
            .snapshots()
            .some((snapshot) => snapshot.ref.workingDirectory === workingDirectory);
          if (!inUse) fileSearch.release(workingDirectory);
        });

      /** Loads the file search index first. A failed open releases an index that no session uses. */
      const withFileSearch = <Value>(
        workingDirectory: string,
        operation: string,
        open: Effect.Effect<Value, HostError>,
      ) =>
        Effect.try({
          // A file search index that cannot load fails the open, as it does for Claude.
          try: () => fileSearch.prewarm(workingDirectory),
          catch: runtimeError(operation),
        }).pipe(
          Effect.andThen(open),
          Effect.tapError(() => releaseUnusedFileSearch(workingDirectory)),
        );

      const queries = createEffectRuntimeQueryAdapter({
        resolveSessionParent: () => Effect.succeed(null),
        loadRuntimeCatalog: (input) =>
          Effect.tryPromise(async () => {
            const [models, slashCommands, skills] = await Promise.all([
              readCatalogSurface(() =>
                readAntigravityModelCatalog({ executablePath, env: readEnv(), cwd: homedir() }),
              ),
              // Antigravity sends the command list only inside a session.
              readCatalogSurface(async () =>
                projection.directorySlashCommands(input.workingDirectory),
              ),
              // Antigravity lists its skills as slash commands.
              readCatalogSurface(async () =>
                toAntigravitySkillCatalog(
                  projection.directorySlashCommands(input.workingDirectory),
                ),
              ),
            ]);
            return { runtime: ANTIGRAVITY_RUNTIME_DESCRIPTOR, models, slashCommands, skills };
          }),
        searchFiles: (input) => Effect.tryPromise(() => fileSearch.search(input)),
        // A session that this runtime holds returns its live projection with no native call.
        loadSessionHistory: (input) =>
          Effect.suspend(() => {
            const live = sessions.find(input);
            if (live) return Effect.succeed(live.history());
            return readNativeSession(input, "antigravity-live-session.load-history").pipe(
              Effect.andThen(
                run("antigravity-live-session.load-history", input, () =>
                  controller.replayHistory(input),
                ),
              ),
            );
          }),
        loadSessionTodos: () => Effect.succeed([]),
        loadSessionDiff: () =>
          Effect.fail(new Error("Antigravity does not provide session diffs.")),
        loadFileStatus: () => Effect.fail(new Error("Antigravity does not provide file status.")),
      });

      const sessionImport: AgentSessionRuntimeAdapterPort["sessionImport"] = {
        scanSessions: () => {
          let batches: WorkspaceSessionExternal[][] | null = null;
          return {
            next: () =>
              Effect.gen(function* () {
                batches ??= toImportBatches(
                  yield* Effect.tryPromise({
                    try: () => listAntigravitySessions(connection),
                    catch: (cause) => toHostOperationError(cause, "sessionImport.scanSessions"),
                  }),
                );
                const batch = batches.shift();
                return batch
                  ? ({ done: false, value: batch } as const)
                  : ({ done: true, value: undefined } as const);
              }),
          };
        },
        inspectSession: (request) =>
          readNativeSession(request, "sessionImport.inspectSession").pipe(
            Effect.map((entry) => ({
              metadata: {
                externalSessionId: request.externalSessionId,
                runtimeKind: "antigravity",
                workingDirectory: request.workingDirectory,
                title: entry?.title ?? null,
                updatedAt: entry?.updatedAt ? Date.parse(entry.updatedAt) : null,
              },
              // `session/list` reports no model, so the session keeps its native model.
              selectedModel: null,
              attach: reattach(request, "sessionImport.attach").pipe(Effect.asVoid),
            })),
          ),
      };

      const releaseRuntime = () =>
        Effect.sync(() => {
          if (projection.released) return [];
          const refs = projection.release();
          controller.releaseRuntime("The Antigravity runtime stopped.");
          fileSearch.dispose();
          runtimeSessions.delete(runtimeId);
          return refs;
        });

      const adapter: AgentSessionRuntimeAdapterPort = {
        supportsSessionControl: true,
        binding,
        textGeneration: {
          generate: (input) =>
            Effect.tryPromise({
              try: (signal) => generateAntigravityText(connection, sessions, input, signal),
              catch: runtimeError("antigravity-live-session.generate-text"),
            }),
          generateJson: (input) =>
            Effect.tryPromise({
              try: async (signal) =>
                readAgentJsonAnswer(
                  "Antigravity",
                  await generateAntigravityText(
                    connection,
                    sessions,
                    { ...input, instructions: agentJsonSchemaInstructions(input) },
                    signal,
                  ),
                  input.answerSchema,
                ),
              catch: runtimeError("antigravity-live-session.generate-json"),
            }),
        },
        sessionImport,
        queries,
        ...unsupportedGeneratedImageOperations,
        resolveGeneratedImageSource: unsupportedGeneratedImageSource,
        resolveCallerBinding: (callerBindingId) =>
          Effect.sync(() => sessions.resolveCallerBinding(callerBindingId)),
        listSnapshots: () => Effect.sync(() => projection.listSnapshots()),
        readSnapshot: (ref) => Effect.sync(() => projection.readSnapshot(ref)),
        loadContext: (input) => Effect.sync(() => sessions.find(input)?.contextUsage ?? null),
        resolvePendingApproval: (input) =>
          Effect.try({
            try: () => {
              const ref = toLiveSessionRef(input);
              return {
                owner: ref,
                root: ref,
                request: sessions.require(ref).pendingApproval(input.requestId),
              };
            },
            catch: sessionError("antigravity-live-session.resolve-pending-approval", input),
          }),
        replyApproval: (input, options) =>
          run("antigravity-live-session.reply-approval", input, async () => {
            options?.onIssued?.();
            await sessions.require(input).replyApproval(input.requestId, input.outcome);
          }),
        replyQuestion: (input) =>
          run("antigravity-live-session.reply-question", input, async () =>
            sessions.require(input).replyQuestion(input.requestId, input.answers),
          ),
        settleRuntimeTranscript: () =>
          Effect.sync(() => controller.settleRuntime("The Antigravity runtime stopped.")),
        releaseRuntime,
        startSession: (input) =>
          withFileSearch(
            input.workingDirectory,
            "antigravity-live-session.start-session",
            Effect.gen(function* () {
              const managedMcpServer = yield* resolveMcpServerConfig(
                input.repoPath,
                input.sessionScope.workspaceId,
              );
              return yield* Effect.tryPromise({
                try: () =>
                  controller.startSession({
                    repoPath: input.repoPath,
                    workingDirectory: input.workingDirectory,
                    sessionScope: input.sessionScope,
                    systemPrompt: input.systemPrompt,
                    model: input.model,
                    managedMcpServer,
                  }),
                catch: runtimeError("antigravity-live-session.start-session"),
              });
            }),
          ).pipe(
            Effect.flatMap((summary) =>
              toAgentSessionControlSummary(summary, "antigravity-live-session.start-session"),
            ),
          ),
        resumeSession: (input) =>
          input.resumeMode === "continue_interrupted_turn"
            ? unsupported(
                "Antigravity cannot continue an interrupted turn. Send a new message instead.",
              )
            : withFileSearch(
                input.workingDirectory,
                "antigravity-live-session.resume-session",
                reattach(
                  {
                    ...toLiveSessionRef(input),
                    sessionScope: input.sessionScope,
                    systemPrompt: input.systemPrompt,
                    model: input.model,
                  },
                  "antigravity-live-session.resume-session",
                ),
              ).pipe(
                Effect.flatMap((summary) =>
                  toAgentSessionControlSummary(summary, "antigravity-live-session.resume-session"),
                ),
              ),
        continueInterruptedTurn: () =>
          unsupported(
            "Antigravity cannot continue an interrupted turn. Send a new message instead.",
          ),
        forkSession: () => unsupported("Antigravity cannot fork a session."),
        sendUserMessage: (input, options) =>
          Effect.tryPromise({
            try: () =>
              sessions.require(toLiveSessionRef(input)).send({
                parts: input.parts.map(toAgentUserMessagePart),
                delivery: input.delivery,
                submissionId: input.submissionId,
                resolvedQuestionRequestIds: input.resolvedQuestionRequestIds,
                workStartGuard: {
                  assertCurrent: () => {
                    input.workStartGuard?.assertCurrent();
                    options?.assertCurrent?.();
                  },
                },
                onWorkIssued: () => {
                  input.onWorkIssued?.();
                  options?.onSent?.();
                },
                onWorkAccepted: input.onWorkAccepted,
              }),
            catch: (cause) =>
              toAgentSessionSendError(cause) ??
              sessionError("antigravity-live-session.send-user-message", input)(cause),
          }),
        controlGoal: () =>
          unsupported("Antigravity has no native goals. Send `/goal` as a message instead."),
        updateSessionModel: (input) =>
          run("antigravity-live-session.update-session-model", input, () =>
            sessions.require(toLiveSessionRef(input)).selectModel(input.model),
          ),
        updateSessionTitle: () => unsupported("Antigravity cannot rename a session."),
        stopSession: (input) =>
          run("antigravity-live-session.stop-session", input, () =>
            controller.stopSession(toLiveSessionRef(input)),
          ),
        // ACP reports no background tasks, so no task of this runtime can run.
        stopBackgroundTask: () => Effect.void,
        releaseSession: (input) =>
          run("antigravity-live-session.release-session", input, () =>
            controller.releaseSession(toLiveSessionRef(input)),
          ).pipe(Effect.andThen(releaseUnusedFileSearch(input.workingDirectory))),
      };

      return {
        adapter,
        acp: {
          handlers: sessions.handlers,
          attachConnection: (acpConnection) => connection.attach(acpConnection),
        },
        startForwarding: projection.startForwarding,
        discard: () => releaseRuntime().pipe(Effect.asVoid),
      } satisfies PreparedAntigravityLiveSessionAdapter;
    });
