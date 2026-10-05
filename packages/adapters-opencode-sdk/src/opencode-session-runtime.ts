import type { ManagedMcpServerResolver } from "@openducktor/core";
import { assertSessionScope } from "./opencode-session-binding";
import {
  createSessionPermissionRestorer,
  beginPermissionSetup,
} from "./opencode-session-permissions";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { createOpenCodeSessionImportPort } from "./opencode-session-import";
import { createOpencodeMcpDirectoryBindings } from "./opencode-mcp-bindings";
import { agentSessionRefsEqual, agentSessionScopesEqual } from "@openducktor/core";
import type { RuntimeSessionImportPort } from "@openducktor/core";
import type {
  AgentCatalogPort,
  AgentSessionQueryParentPort,
  AgentSessionHistoryPort,
  AgentWorkspaceInspectionPort,
  AcceptedAgentUserMessage,
  AgentEvent,
  ContinueInterruptedAgentTurnInput,
  AgentSessionSummary,
  AgentSessionTitleUpdateResult,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type AgentSessionAuthorizedRoot,
  type AgentSessionControlUpdateTitleInput,
} from "@openducktor/contracts";
import {
  applyOpencodeAwaitingTurnStartToRuntimeSnapshot,
  listOpencodeRuntimeSnapshotSources,
  type OpencodeRuntimeSnapshotRead,
} from "./live-session-snapshots";
import { readSessionLifecycleEvent } from "./event-stream/shared";
import type { ParsedOpencodeEvent as Event } from "./opencode-global-event-ingress";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";
import {
  type OpencodeNativeApprovalReply,
  type OpencodeNativeQuestionReply,
  readLatestOpencodeContextUsage,
  replyToOpencodeApproval,
  replyToOpencodeQuestion,
} from "./opencode-session-native-operations";
import { readOpencodeSessionContextSignal } from "./opencode-agent-session-projection";
import {
  type OpencodeSessionContextUsage,
  type OpencodeSessionRuntimeSignal,
  toOpencodeObservationFailureMessage,
} from "./opencode-session-runtime-signals";
import { observeRuntimeEvents, registerSession, releaseSessionRuntime } from "./session-registry";
import type {
  OpencodeSdkAdapterOptions,
  ReadOpencodeDirectory,
  RuntimeEventTransportRecord,
  SessionRecord,
} from "./types";

export type PrepareOpencodeSessionRuntimeInput = {
  readonly runtimeId: string;
  readonly runtimeEndpoint: string;
  readonly directories?: string[];
  readonly signal?: AbortSignal;
};

export type {
  OpencodeNativeApprovalReply,
  OpencodeNativeQuestionReply,
} from "./opencode-session-native-operations";

export type OpencodeSessionRuntimeConnection = {
  /**
   * Reads the live sources of one repository. Given roots replace that repository's roots.
   * Sessions of other repositories stay registered.
   */
  readonly readSessionSources: (
    repoPath: string,
    roots?: AgentSessionAuthorizedRoot[],
  ) => Promise<OpencodeRuntimeSnapshotRead>;
  readonly loadContextUsage: (ref: SessionRef) => Promise<OpencodeSessionContextUsage | null>;
  readonly replyApproval: (input: OpencodeNativeApprovalReply) => Promise<void>;
  readonly replyQuestion: (input: OpencodeNativeQuestionReply) => Promise<void>;
  readonly startSession: (input: StartAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly resumeSession: (input: ResumeAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly continueInterruptedTurn: (
    input: ContinueInterruptedAgentTurnInput,
  ) => Promise<AgentSessionSummary>;
  readonly forkSession: (input: ForkAgentSessionInput) => Promise<AgentSessionSummary>;
  readonly sendUserMessage: (input: SendAgentUserMessageInput) => Promise<AcceptedAgentUserMessage>;
  readonly updateSessionModel: (input: UpdateAgentSessionModelInput) => Promise<void>;
  readonly updateSessionTitle: (
    input: AgentSessionControlUpdateTitleInput,
  ) => Promise<AgentSessionTitleUpdateResult>;
  readonly stopSession: (input: SessionRef) => Promise<void>;
  readonly releaseSession: (input: SessionRef) => Promise<void>;
};

export type PreparedOpencodeSessionRuntime = {
  readonly sessionImport: RuntimeSessionImportPort;
  readonly queries: AgentCatalogPort &
    AgentSessionHistoryPort &
    AgentWorkspaceInspectionPort &
    AgentSessionQueryParentPort;
  readonly connection: OpencodeSessionRuntimeConnection;
  readonly startForwarding: (
    listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
  ) => Promise<void>;
  readonly release: () => Promise<void>;
};

export type PrepareOpencodeSessionRuntime = (
  input: PrepareOpencodeSessionRuntimeInput,
) => Promise<PreparedOpencodeSessionRuntime>;

type PrepareOpencodeSessionRuntimeOptions = Omit<
  OpencodeSdkAdapterOptions,
  "runtime" | "mcpBindings"
> & {
  readonly readDirectory: ReadOpencodeDirectory;
  readonly resolveMcpServerConfig: ManagedMcpServerResolver;
};

export const createPrepareOpencodeSessionRuntime = (
  options: PrepareOpencodeSessionRuntimeOptions,
): PrepareOpencodeSessionRuntime => {
  const { readDirectory, resolveMcpServerConfig, ...adapterOptions } = options;
  const createClient = adapterOptions.createClient ?? buildDefaultFactory();
  const now = adapterOptions.now ?? nowIso;
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();

  return async (input) => {
    const eventSessions = new Map<string, SessionRecord>();
    const restorePermissions = createSessionPermissionRestorer();
    const mcpBindings = createOpencodeMcpDirectoryBindings({
      resolveServerConfig: resolveMcpServerConfig,
    });
    const controlAdapter = new OpencodeSdkAdapter(
      {
        ...adapterOptions,
        mcpBindings,
        runtime: {
          kind: "opencode",
          runtimeId: input.runtimeId,
          runtimeRoute: { type: "local_http", endpoint: input.runtimeEndpoint },
        },
      },
      { sessions: eventSessions, runtimeEventTransports, restorePermissions },
    );
    const pendingSignals: OpencodeSessionRuntimeSignal[] = [];
    const pendingSessionSignals: OpencodeSessionRuntimeSignal[] = [];
    const eventsBeforeSubscribers: Event[] = [];
    const initializationEvents: Event[] = [];
    let forwardingListener:
      | ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>)
      | null = null;
    let deliveryTail = Promise.resolve();
    let startingForwarding = false;
    let initializing = true;
    let subscribersReady = false;
    let released = false;

    const requireActive = (): void => {
      if (released) {
        throw new Error(`OpenCode runtime '${input.runtimeId}' has been released.`);
      }
    };

    const emitSignal = async (signal: OpencodeSessionRuntimeSignal): Promise<void> => {
      if (released) {
        return;
      }
      if (!forwardingListener) {
        pendingSignals.push(signal);
        return;
      }
      const listener = forwardingListener;
      const delivery = deliveryTail.then(() => listener(signal));
      deliveryTail = delivery.then(
        () => undefined,
        () => undefined,
      );
      await delivery;
    };

    const drainSessionSignals = async (): Promise<void> => {
      while (pendingSessionSignals.length > 0) {
        const signal = pendingSessionSignals.shift();
        if (signal) {
          await emitSignal(signal);
        }
      }
    };

    const belongsToRegisteredRoot = (
      externalSessionId: string,
      parentExternalSessionId?: string,
    ): boolean => {
      const eventTransport = runtimeEventTransports.get(input.runtimeId);
      let currentId: string | undefined = externalSessionId;
      let parentId = parentExternalSessionId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        if (eventSessions.has(currentId)) {
          return true;
        }
        const nextId: string | undefined =
          parentId ??
          eventTransport?.parentExternalSessionIdByChildExternalSessionId.get(currentId);
        currentId = nextId;
        parentId = undefined;
      }
      return false;
    };

    /** Syncs event bindings of one repository. `bindings` holds only its sessions. */
    const syncEventSessions = async (
      { sources, failures }: OpencodeRuntimeSnapshotRead,
      bindings: ReadonlyMap<string, SessionRecord>,
      roots: readonly AgentSessionAuthorizedRoot[],
    ): Promise<void> => {
      const sourceIds = new Set([
        ...sources.map((source) => source.externalSessionId),
        ...failures.map((failure) => failure.externalSessionId),
      ]);
      for (const session of bindings.values()) {
        const scope = session.input.sessionScope;
        const hasSource = sources.some(
          (source) =>
            source.externalSessionId === session.externalSessionId &&
            source.workingDirectory === session.input.workingDirectory,
        );
        const failure = failures.find(
          (candidate) =>
            (candidate.externalSessionId === session.externalSessionId &&
              candidate.workingDirectory === session.input.workingDirectory) ||
            (!hasSource &&
              scope?.kind === "workflow" &&
              roots.some(
                (root) =>
                  root.externalSessionId === candidate.externalSessionId &&
                  root.workingDirectory === candidate.workingDirectory &&
                  agentSessionScopesEqual(root.sessionScope, scope),
              )),
        );
        if (failure && session.input.sessionScope?.kind === "workflow")
          session.permissionSetupError = new Error(failure.message);
        if (
          !sourceIds.has(session.externalSessionId) &&
          !session.permissionSetupError &&
          eventSessions.get(session.externalSessionId) === session
        ) {
          await releaseSessionRuntime(session, eventSessions, runtimeEventTransports);
        }
      }
      for (const source of sources) {
        const existing = eventSessions.get(source.externalSessionId);
        const sessionScope =
          source.sessionAssociation.kind === "unbound" ? undefined : source.sessionAssociation;
        if (existing?.input.workingDirectory === source.workingDirectory) {
          if (sessionScope) {
            existing.input.sessionScope = sessionScope;
            existing.summary = { ...existing.summary, sessionAssociation: sessionScope };
          }
          continue;
        }
        if (existing) {
          await releaseSessionRuntime(existing, eventSessions, runtimeEventTransports);
        }
        const sessionInput: SessionRecord["input"] = {
          repoPath: source.repoPath,
          runtimeKind: "opencode" as const,
          workingDirectory: source.workingDirectory,
          runtimePolicy: { kind: "opencode" as const },
          systemPrompt: "",
        };
        if (sessionScope) sessionInput.sessionScope = sessionScope;
        const registrationInput: Parameters<typeof registerSession>[0] = {
          sessions: eventSessions,
          runtimeEventTransports,
          createClient,
          runtimeId: input.runtimeId,
          runtimeEndpoint: input.runtimeEndpoint,
          externalSessionId: source.externalSessionId,
          sessionInput,
          client: createClient({
            runtimeEndpoint: input.runtimeEndpoint,
            workingDirectory: source.workingDirectory,
          }),
          startedAt: source.startedAt,
          emitStartedEvent: false,
          now,
          emit: (externalSessionId, event) => {
            pendingSessionSignals.push({ type: "session_event", externalSessionId, event });
          },
        };
        if (adapterOptions.logEvent) {
          registrationInput.logEvent = adapterOptions.logEvent;
        }
        registerSession(registrationInput);
      }
    };

    const attachTails = new Map<string, Promise<void>>();
    const pendingSends = new Set<{ ref: SessionRef; controller: AbortController }>();
    const setAttachTail = (repoPath: string, tail: Promise<void>): void => {
      attachTails.set(repoPath, tail);
      void tail.then(() => {
        if (attachTails.get(repoPath) === tail) attachTails.delete(repoPath);
      });
    };
    const cancelPendingSends = (ref: SessionRef, action: "stopped" | "released"): void => {
      for (const pending of pendingSends) {
        if (agentSessionRefsEqual(pending.ref, ref)) {
          pending.controller.abort(
            new Error(
              `Pending OpenCode message for session '${ref.externalSessionId}' was canceled because the session was ${action}. Resume the session to send a new message.`,
            ),
          );
        }
      }
    };
    const authorizedRootsByRepo = new Map<string, AgentSessionAuthorizedRoot[]>();
    const admittedRoots = new Map<string, AgentSessionAuthorizedRoot>();
    const readSessionSources = (
      repoPath: string,
      roots?: AgentSessionAuthorizedRoot[],
    ): Promise<OpencodeRuntimeSnapshotRead> => {
      const read = (attachTails.get(repoPath) ?? Promise.resolve()).then(async () => {
        requireActive();
        const foreignRoot = roots?.find((root) => root.repoPath !== repoPath);
        if (foreignRoot) {
          throw new Error(
            `Cannot refresh OpenCode sessions of repository '${repoPath}' with root '${foreignRoot.externalSessionId}' of repository '${foreignRoot.repoPath}'.`,
          );
        }
        const repoRoots = roots ?? authorizedRootsByRepo.get(repoPath) ?? [];
        const rootsToRead = [
          ...repoRoots,
          ...[...admittedRoots.values()].filter((root) => root.repoPath === repoPath),
        ];
        const bindings = new Map(
          [...eventSessions].filter(([, session]) => session.input.repoPath === repoPath),
        );
        // Block sends until the refresh checks each workflow tree or drops its binding.
        const permissionSessions = roots
          ? [...bindings.values()].filter(
              (session) => session.input.sessionScope?.kind === "workflow",
            )
          : [];
        const finishPermissionSetups = permissionSessions.map(beginPermissionSetup);
        try {
          const snapshotInput: Parameters<typeof listOpencodeRuntimeSnapshotSources>[0] = {
            createClient,
            runtimeEndpoint: input.runtimeEndpoint,
            roots: rootsToRead,
            attachSession: async (detail, scope, descendant, rootRepoPath) => {
              const existing = eventSessions.get(detail.id);
              if (scope && existing)
                assertSessionScope(
                  existing,
                  {
                    repoPath: rootRepoPath,
                    runtimeKind: "opencode",
                    workingDirectory: detail.directory,
                    externalSessionId: detail.id,
                    runtimePolicy: { kind: "opencode" },
                    sessionScope: scope,
                  },
                  "attach session",
                );
              if (!roots && existing) {
                if (existing.permissionSetupError) throw existing.permissionSetupError;
                return;
              }
              if (scope?.kind !== "workflow") return;
              const client = createClient({
                runtimeEndpoint: input.runtimeEndpoint,
                workingDirectory: detail.directory,
              });
              const policy = resolveOpencodeSessionPolicy(
                scope,
                OPENCODE_RUNTIME_DESCRIPTOR,
                "attach session",
              );
              if (descendant) {
                // Children keep their own allows; only parent denials carry over.
                policy.permission = policy.permission.filter((rule) => rule.action === "deny");
              }
              await restorePermissions({
                client,
                externalSessionId: detail.id,
                workingDirectory: detail.directory,
                policy,
              });
              if (existing) delete existing.permissionSetupError;
            },
            readDirectory,
            now,
          };
          if (input.directories) {
            snapshotInput.directories = input.directories;
          }
          const result = await listOpencodeRuntimeSnapshotSources(snapshotInput);
          requireActive();
          const shouldRetainRoot = (root: AgentSessionAuthorizedRoot): boolean =>
            root.sessionScope.kind === "repository" ||
            result.sources.some(
              (source) =>
                source.externalSessionId === root.externalSessionId &&
                source.workingDirectory === root.workingDirectory,
            );
          const retainedRoots = repoRoots.filter(shouldRetainRoot);
          if (retainedRoots.length > 0) {
            authorizedRootsByRepo.set(repoPath, retainedRoots);
          } else {
            authorizedRootsByRepo.delete(repoPath);
          }
          for (const root of rootsToRead) {
            if (roots?.includes(root) || !shouldRetainRoot(root))
              admittedRoots.delete(root.externalSessionId);
          }
          await syncEventSessions(result, bindings, rootsToRead);
          requireActive();
          return {
            ...result,
            sources: result.sources.map((source) =>
              applyOpencodeAwaitingTurnStartToRuntimeSnapshot({
                sessions: eventSessions,
                runtimeId: input.runtimeId,
                snapshot: source,
              }),
            ),
          };
        } catch (cause) {
          for (const session of permissionSessions)
            session.permissionSetupError = new Error(
              `Failed to restore permissions for OpenCode session '${session.externalSessionId}' in '${session.input.workingDirectory}'. Reconnect the selected runtime and retry attachment: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          throw cause;
        } finally {
          for (const finish of finishPermissionSetups) finish();
        }
      });
      setAttachTail(
        repoPath,
        read.then(
          () => undefined,
          () => undefined,
        ),
      );
      return read;
    };

    const forwardEventSignals = async (event: Event): Promise<void> => {
      await drainSessionSignals();
      const lifecycleEvent = readSessionLifecycleEvent(event);
      if (
        lifecycleEvent?.type === "session.deleted" &&
        belongsToRegisteredRoot(
          lifecycleEvent.externalSessionId,
          lifecycleEvent.parentExternalSessionId,
        )
      ) {
        const session = eventSessions.get(lifecycleEvent.externalSessionId);
        if (session) {
          await releaseSessionRuntime(session, eventSessions, runtimeEventTransports);
        }
        await emitSignal({
          type: "session_removed",
          externalSessionId: lifecycleEvent.externalSessionId,
        });
      }
      const contextSignal = readOpencodeSessionContextSignal(event);
      if (contextSignal && belongsToRegisteredRoot(contextSignal.externalSessionId)) {
        await emitSignal(contextSignal);
      }
    };

    const observationInput: Parameters<typeof observeRuntimeEvents>[0] = {
      runtimeEventTransports,
      createClient,
      runtimeId: input.runtimeId,
      runtimeEndpoint: input.runtimeEndpoint,
      sessions: eventSessions,
      now,
      emit: (externalSessionId, event: AgentEvent) => {
        pendingSessionSignals.push({ type: "session_event", externalSessionId, event });
      },
      observer: async (event) => {
        if (event.type === "server.instance.disposed") {
          mcpBindings.forget(event.properties.directory);
          return;
        }
        if (initializing) {
          initializationEvents.push(event);
          if (!subscribersReady) {
            eventsBeforeSubscribers.push(event);
          }
          return;
        }
        await forwardEventSignals(event);
      },
      terminalObserver: (error) =>
        emitSignal({ type: "fault", message: toOpencodeObservationFailureMessage(error) }),
    };
    if (input.signal) {
      observationInput.signal = input.signal;
    }
    if (adapterOptions.logEvent) {
      observationInput.logEvent = adapterOptions.logEvent;
    }
    const observation = await observeRuntimeEvents(observationInput);

    const initialize = async (): Promise<void> => {
      subscribersReady = true;
      for (const event of eventsBeforeSubscribers.splice(0)) {
        await observation.dispatch(event);
        requireActive();
      }
      initializationEvents.length = 0;
      await drainSessionSignals();
      requireActive();
      initializing = false;
    };

    try {
      await waitForRuntimeInitialization(initialize(), input.signal, input.runtimeId);
    } catch (error) {
      released = true;
      const cleanupFailures: unknown[] = [];
      try {
        await releaseEventSessions(eventSessions, runtimeEventTransports);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      try {
        await observation.release();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          `Failed to initialize OpenCode runtime '${input.runtimeId}' and release its partial resources.`,
        );
      }
      throw error;
    }

    /** Binds the OpenDucktor MCP server of the owning workspace before work in a directory. */
    const ensureDirectoryMcpBinding = (ref: { repoPath: string; workingDirectory: string }) =>
      mcpBindings.ensure({
        client: createClient({
          runtimeEndpoint: input.runtimeEndpoint,
          workingDirectory: ref.workingDirectory,
        }),
        repoPath: ref.repoPath,
        workingDirectory: ref.workingDirectory,
      });

    const nativeContext = { createClient, runtimeEndpoint: input.runtimeEndpoint };
    const connection: OpencodeSessionRuntimeConnection = {
      readSessionSources,
      loadContextUsage: (ref) => readLatestOpencodeContextUsage(nativeContext, ref),
      // A reply continues the turn, so its directory needs the workspace binding first.
      replyApproval: async (reply) => {
        await ensureDirectoryMcpBinding(reply.ref);
        await replyToOpencodeApproval(nativeContext, reply);
      },
      replyQuestion: async (reply) => {
        await ensureDirectoryMcpBinding(reply.ref);
        await replyToOpencodeQuestion(nativeContext, reply);
      },
      startSession: async (sessionInput) => {
        const summary = await controlAdapter.startSession(sessionInput);
        admittedRoots.set(summary.externalSessionId, {
          repoPath: sessionInput.repoPath,
          runtimeKind: "opencode",
          externalSessionId: summary.externalSessionId,
          workingDirectory: sessionInput.workingDirectory,
          sessionScope: sessionInput.sessionScope!,
        });
        return summary;
      },
      resumeSession: async (sessionInput) => {
        const summary = await controlAdapter.resumeSession(sessionInput);
        admittedRoots.set(summary.externalSessionId, {
          ...sessionInput,
          sessionScope: sessionInput.sessionScope!,
        });
        return summary;
      },
      continueInterruptedTurn: (sessionInput) =>
        controlAdapter.continueInterruptedTurn(sessionInput),
      forkSession: async (sessionInput) => {
        const summary = await controlAdapter.forkSession(sessionInput);
        admittedRoots.set(summary.externalSessionId, {
          repoPath: sessionInput.repoPath,
          runtimeKind: "opencode",
          externalSessionId: summary.externalSessionId,
          workingDirectory: sessionInput.workingDirectory,
          sessionScope: sessionInput.sessionScope!,
        });
        return summary;
      },
      sendUserMessage: (messageInput) => {
        const pending = { ref: messageInput, controller: new AbortController() };
        pendingSends.add(pending);
        const signal = pending.controller.signal;
        let abort!: () => void;
        const aborted = new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason);
        });
        const clearPending = (): void => {
          signal.removeEventListener("abort", abort);
          pendingSends.delete(pending);
        };
        signal.addEventListener("abort", abort, { once: true });
        let markSent!: () => void;
        const sent = new Promise<void>((resolve) => {
          markSent = resolve;
        });
        const sending = (attachTails.get(messageInput.repoPath) ?? Promise.resolve()).then(() => {
          requireActive();
          signal.throwIfAborted();
          return controlAdapter.sendUserMessage(messageInput, {
            signal,
            onSent: () => {
              clearPending();
              markSent();
            },
          });
        });
        // Reads can restore permissions, so hold them until the native call or failure.
        // A pending reply or stream admission must not block reads.
        setAttachTail(
          messageInput.repoPath,
          Promise.race([
            sent,
            sending.then(
              () => undefined,
              () => undefined,
            ),
          ]),
        );
        // Stop releases the caller while reads still wait for unfinished setup.
        return Promise.race([sending, aborted]).finally(clearPending);
      },
      updateSessionModel: (modelInput) => controlAdapter.updateSessionModel(modelInput),
      updateSessionTitle: (titleInput) => controlAdapter.updateSessionTitle(titleInput),
      stopSession: (ref) => {
        cancelPendingSends(ref, "stopped");
        return controlAdapter.stopSession(ref);
      },
      releaseSession: async (ref) => {
        cancelPendingSends(ref, "released");
        await controlAdapter.releaseSession(ref);
        const admittedRoot = admittedRoots.get(ref.externalSessionId);
        if (admittedRoot && agentSessionRefsEqual(admittedRoot, ref)) {
          admittedRoots.delete(ref.externalSessionId);
        }
        const repoRoots = authorizedRootsByRepo.get(ref.repoPath);
        if (repoRoots) {
          authorizedRootsByRepo.set(
            ref.repoPath,
            repoRoots.filter((root) => !agentSessionRefsEqual(root, ref)),
          );
        }
      },
    };

    const startForwarding = async (
      listener: (signal: OpencodeSessionRuntimeSignal) => void | Promise<void>,
    ): Promise<void> => {
      requireActive();
      if (forwardingListener || startingForwarding) {
        throw new Error(`OpenCode runtime '${input.runtimeId}' is already forwarding.`);
      }
      startingForwarding = true;
      try {
        while (pendingSignals.length > 0) {
          const signal = pendingSignals.shift();
          if (signal) {
            await listener(signal);
          }
          requireActive();
        }
        forwardingListener = listener;
      } finally {
        startingForwarding = false;
      }
    };

    // Release closes the runtime at once. Each cleanup step is final once it succeeds, and a
    // later release retries only the steps that failed.
    let eventSessionsReleased = false;
    let observationReleased = false;
    const release = async (): Promise<void> => {
      released = true;
      for (const pending of pendingSends) {
        pending.controller.abort(
          new Error(
            `Pending OpenCode message for session '${pending.ref.externalSessionId}' was canceled because runtime '${input.runtimeId}' was released. Reconnect the runtime to send a new message.`,
          ),
        );
      }
      pendingSends.clear();
      attachTails.clear();
      forwardingListener = null;
      mcpBindings.clear();
      const failures: Error[] = [];
      if (!eventSessionsReleased) {
        try {
          await releaseEventSessions(eventSessions, runtimeEventTransports);
          eventSessionsReleased = true;
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error("OpenCode cleanup failed."));
        }
      }
      if (!observationReleased) {
        try {
          await observation.release();
          observationReleased = true;
        } catch (error) {
          failures.push(
            error instanceof Error ? error : new Error("OpenCode observation cleanup failed."),
          );
        }
      }
      pendingSignals.length = 0;
      pendingSessionSignals.length = 0;
      eventsBeforeSubscribers.length = 0;
      initializationEvents.length = 0;
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to release OpenCode runtime '${input.runtimeId}': ${failures
            .map((failure) => failure.message)
            .join("; ")}`,
        );
      }
    };

    return {
      sessionImport: createOpenCodeSessionImportPort({
        createClient,
        runtimeEndpoint: input.runtimeEndpoint,
        // An imported root gets its workspace binding before it is admitted. A failure leaves
        // the root out, and the host reports it on the saved association.
        admit: async (ref) => {
          await ensureDirectoryMcpBinding(ref);
          admittedRoots.set(ref.externalSessionId, {
            ...ref,
            sessionScope: { kind: "repository" },
          });
          await readSessionSources(ref.repoPath);
        },
      }),
      queries: controlAdapter,
      connection,
      startForwarding,
      release,
    };
  };
};

const runtimeInitializationAbortFailure = (signal: AbortSignal, runtimeId: string): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new Error(`OpenCode runtime '${runtimeId}' initialization was aborted.`);

const waitForRuntimeInitialization = <Value>(
  initialization: Promise<Value>,
  signal: AbortSignal | undefined,
  runtimeId: string,
): Promise<Value> => {
  if (!signal) return initialization;
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      complete();
    };
    const abort = (): void =>
      finish(() => reject(runtimeInitializationAbortFailure(signal, runtimeId)));
    signal.addEventListener("abort", abort, { once: true });
    void initialization.then(
      (value) => finish(() => resolve(value)),
      (cause: unknown) => finish(() => reject(cause)),
    );
    if (signal.aborted) abort();
  });
};

const releaseEventSessions = async (
  sessions: Map<string, SessionRecord>,
  runtimeEventTransports: Map<string, RuntimeEventTransportRecord>,
): Promise<void> => {
  const failures: Error[] = [];
  // oxlint-disable-next-line unicorn/no-useless-spread -- cleanup awaits and must not include new sessions
  for (const session of [...sessions.values()]) {
    try {
      await releaseSessionRuntime(session, sessions, runtimeEventTransports);
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(`OpenCode session '${session.externalSessionId}' cleanup failed.`),
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to release ${failures.length} OpenCode session ${
        failures.length === 1 ? "resource" : "resources"
      }: ${failures.map((failure) => failure.message).join("; ")}`,
    );
  }
};
