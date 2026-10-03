import { assertSessionScope } from "./opencode-session-binding";
import { restoreSessionPermissions, beginPermissionSetup } from "./opencode-session-permissions";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { createOpenCodeSessionImportPort } from "./opencode-session-import";
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
  type AgentSessionScope,
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
  readonly repoPath: string;
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
  readonly readSessionSources: (
    roots?: AgentSessionAuthorizedRoot[],
  ) => Promise<OpencodeRuntimeSnapshotRead>;
  readonly readSessionTree: (
    root: SessionRef,
    install?: (read: OpencodeRuntimeSnapshotRead) => Promise<void>,
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

type PrepareOpencodeSessionRuntimeOptions = OpencodeSdkAdapterOptions & {
  readonly readDirectory: ReadOpencodeDirectory;
};

type RuntimeRoot = SessionRef & { sessionScope?: AgentSessionScope };

export const createPrepareOpencodeSessionRuntime = (
  options: PrepareOpencodeSessionRuntimeOptions,
): PrepareOpencodeSessionRuntime => {
  const { readDirectory, ...adapterOptions } = options;
  const createClient = adapterOptions.createClient ?? buildDefaultFactory();
  const now = adapterOptions.now ?? nowIso;
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();

  return async (input) => {
    const eventSessions = new Map<string, SessionRecord>();
    const controlAdapter = new OpencodeSdkAdapter(
      {
        ...adapterOptions,
        repoRuntimeResolver: {
          requireRepoRuntime: async () => ({
            kind: "opencode",
            runtimeId: input.runtimeId,
            repoPath: input.repoPath,
            runtimeRoute: { type: "local_http", endpoint: input.runtimeEndpoint },
          }),
        },
      },
      { sessions: eventSessions, runtimeEventTransports },
    );
    const pendingSignals: OpencodeSessionRuntimeSignal[] = [];
    const pendingSessionSignals: OpencodeSessionRuntimeSignal[] = [];
    const eventsBeforeSubscribers: Event[] = [];
    let forwardingListener:
      | ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>)
      | null = null;
    let deliveryTail = Promise.resolve();
    let startingForwarding = false;
    let initializing = true;
    let restoringTree = false;
    const treeEvents: Event[] = [];
    let released = false;
    let observationFailure: Error | undefined;

    const requireActive = (): void => {
      if (observationFailure) throw observationFailure;
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

    const syncEventSessions = async (
      { sources, failures }: OpencodeRuntimeSnapshotRead,
      bindings: ReadonlyMap<string, SessionRecord>,
      roots: readonly RuntimeRoot[],
    ): Promise<void> => {
      const sourceIds = new Set([
        ...sources.map((source) => source.externalSessionId),
        ...failures.map((failure) => failure.externalSessionId),
      ]);
      const failedIds = new Set(failures.map((failure) => failure.externalSessionId));
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const session of bindings.values()) {
          const parentId = runtimeEventTransports
            .get(input.runtimeId)
            ?.parentExternalSessionIdByChildExternalSessionId.get(session.externalSessionId);
          if (parentId && failedIds.has(parentId) && !failedIds.has(session.externalSessionId)) {
            failedIds.add(session.externalSessionId);
            sourceIds.add(session.externalSessionId);
            expanded = true;
          }
        }
      }
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
                  root.sessionScope !== undefined &&
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
          repoPath: input.repoPath,
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

    let readTail = Promise.resolve();
    let authorizedRoots: AgentSessionAuthorizedRoot[] = [];
    const admittedRoots = new Map<string, RuntimeRoot>();
    const readSessionSources = (
      roots?: AgentSessionAuthorizedRoot[],
      treeRoot?: SessionRef,
      install?: (read: OpencodeRuntimeSnapshotRead) => Promise<void>,
    ): Promise<OpencodeRuntimeSnapshotRead> => {
      const read = readTail.then(async () => {
        requireActive();
        if (treeRoot) restoringTree = true;
        const restoredRoot: RuntimeRoot | undefined = treeRoot
          ? (admittedRoots.get(treeRoot.externalSessionId) ??
            authorizedRoots.find((root) => agentSessionRefsEqual(root, treeRoot)) ??
            treeRoot)
          : undefined;
        if (restoredRoot) admittedRoots.set(restoredRoot.externalSessionId, restoredRoot);
        const rootsToRead = restoredRoot
          ? [restoredRoot]
          : [...(roots ?? authorizedRoots), ...admittedRoots.values()];
        const bindings = new Map(eventSessions);
        if (treeRoot) {
          const ids = new Set([treeRoot.externalSessionId]);
          const parents = runtimeEventTransports.get(
            input.runtimeId,
          )?.parentExternalSessionIdByChildExternalSessionId;
          let expanded = true;
          while (expanded) {
            expanded = false;
            for (const [child, parent] of parents ?? [])
              if (ids.has(parent) && !ids.has(child)) {
                ids.add(child);
                expanded = true;
              }
          }
          for (const id of bindings.keys()) if (!ids.has(id)) bindings.delete(id);
        }
        // Block sends until the refresh checks each workflow tree or drops its binding.
        const permissionSessions =
          roots || treeRoot
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
            attachSession: async (detail, scope, descendant) => {
              const existing = eventSessions.get(detail.id);
              if (scope && existing)
                assertSessionScope(
                  existing,
                  {
                    repoPath: input.repoPath,
                    runtimeKind: "opencode",
                    workingDirectory: detail.directory,
                    externalSessionId: detail.id,
                    runtimePolicy: { kind: "opencode" },
                    sessionScope: scope,
                  },
                  "attach session",
                );
              if (!roots && !treeRoot && existing) {
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
              await restoreSessionPermissions({
                client,
                externalSessionId: detail.id,
                workingDirectory: detail.directory,
                policy,
                detail,
              });
              if (existing) delete existing.permissionSetupError;
            },
            readDirectory,
            now,
            readContextUsage: (ref) =>
              readLatestOpencodeContextUsage(
                { createClient, runtimeEndpoint: input.runtimeEndpoint },
                ref,
              ),
          };
          if (input.directories) {
            snapshotInput.directories = input.directories;
          }
          const result = await listOpencodeRuntimeSnapshotSources(snapshotInput);
          requireActive();
          const shouldRetainRoot = (root: RuntimeRoot): boolean =>
            root.sessionScope?.kind === "repository" ||
            result.sources.some(
              (source) =>
                source.externalSessionId === root.externalSessionId &&
                source.workingDirectory === root.workingDirectory,
            );
          if (!treeRoot) authorizedRoots = (roots ?? authorizedRoots).filter(shouldRetainRoot);
          for (const root of rootsToRead) {
            if (
              roots?.some((authorized) => agentSessionRefsEqual(authorized, root)) ||
              !shouldRetainRoot(root)
            )
              admittedRoots.delete(root.externalSessionId);
          }
          await syncEventSessions(result, bindings, rootsToRead);
          await initialize();
          requireActive();
          const recovered = {
            ...result,
            sources: result.sources.map((source) =>
              applyOpencodeAwaitingTurnStartToRuntimeSnapshot({
                sessions: eventSessions,
                runtimeId: input.runtimeId,
                snapshot: source,
              }),
            ),
          };
          if (treeRoot) {
            await install?.(recovered);
            for (let index = 0; index < treeEvents.length; index++) {
              const event = treeEvents[index]!;
              if (!(await observation.dispatch(event)))
                throw new Error(
                  "OpenCode event projection failed during restore. Stop and start the assigned runtime.",
                );
              await forwardEventSignals(event);
            }
          }
          return recovered;
        } catch (cause) {
          for (const session of permissionSessions)
            session.permissionSetupError = new Error(
              `Failed to restore permissions for OpenCode session '${session.externalSessionId}' in '${session.input.workingDirectory}'. Reconnect the selected runtime and retry attachment: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          if (treeRoot && !released) {
            const error =
              cause instanceof Error
                ? cause
                : new Error("OpenCode session tree restore failed.", { cause });
            observationFailure ??= observation.fail(error);
            throw observationFailure;
          }
          throw cause;
        } finally {
          for (const finish of finishPermissionSetups) finish();
          if (treeRoot) {
            restoringTree = false;
            treeEvents.length = 0;
          }
        }
      });
      readTail = read.then(
        () => undefined,
        () => undefined,
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
      // Hold events until the host installs the restored tree.
      deferEvent: (event) => {
        if (restoringTree) {
          treeEvents.push(event);
          return true;
        }
        if (initializing) {
          eventsBeforeSubscribers.push(event);
          return true;
        }
        return false;
      },
      observer: forwardEventSignals,
      terminalObserver: (error) => {
        observationFailure = error;
        return emitSignal({ type: "fault", message: toOpencodeObservationFailureMessage(error) });
      },
    };
    if (input.signal) {
      observationInput.signal = input.signal;
    }
    if (adapterOptions.logEvent) {
      observationInput.logEvent = adapterOptions.logEvent;
    }
    const observation = await observeRuntimeEvents(observationInput);

    const initialize = async (): Promise<void> => {
      if (!initializing) return;
      await drainSessionSignals();
      requireActive();
      for (let index = 0; index < eventsBeforeSubscribers.length; index += 1) {
        const event = eventsBeforeSubscribers[index]!;
        if (!(await observation.dispatch(event)))
          throw new Error(
            "OpenCode event projection failed during attachment. Stop and start the assigned runtime.",
          );
        await forwardEventSignals(event);
        requireActive();
      }
      eventsBeforeSubscribers.length = 0;
      initializing = false;
    };

    try {
      if (input.signal?.aborted)
        throw runtimeInitializationAbortFailure(input.signal, input.runtimeId);
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

    const connection: OpencodeSessionRuntimeConnection = {
      readSessionSources,
      readSessionTree: (root, install) => readSessionSources(undefined, root, install),
      loadContextUsage: (ref) =>
        readLatestOpencodeContextUsage(
          { createClient, runtimeEndpoint: input.runtimeEndpoint },
          ref,
        ),
      replyApproval: (reply) =>
        replyToOpencodeApproval({ createClient, runtimeEndpoint: input.runtimeEndpoint }, reply),
      replyQuestion: (reply) =>
        replyToOpencodeQuestion({ createClient, runtimeEndpoint: input.runtimeEndpoint }, reply),
      startSession: async (sessionInput) => {
        const summary = await controlAdapter.startSession(sessionInput);
        admittedRoots.set(summary.externalSessionId, {
          repoPath: sessionInput.repoPath,
          runtimeKind: "opencode",
          externalSessionId: summary.externalSessionId,
          workingDirectory: sessionInput.workingDirectory,
          sessionScope: sessionInput.sessionScope!,
        });
        await initialize();
        return summary;
      },
      resumeSession: async (sessionInput) => {
        const summary = await controlAdapter.resumeSession(sessionInput);
        admittedRoots.set(summary.externalSessionId, {
          ...sessionInput,
          sessionScope: sessionInput.sessionScope!,
        });
        await initialize();
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
        await initialize();
        return summary;
      },
      sendUserMessage: (messageInput) => controlAdapter.sendUserMessage(messageInput),
      updateSessionModel: (modelInput) => controlAdapter.updateSessionModel(modelInput),
      updateSessionTitle: (titleInput) => controlAdapter.updateSessionTitle(titleInput),
      stopSession: (ref) => controlAdapter.stopSession(ref),
      releaseSession: async (ref) => {
        await controlAdapter.releaseSession(ref);
        const admittedRoot = admittedRoots.get(ref.externalSessionId);
        if (admittedRoot && agentSessionRefsEqual(admittedRoot, ref)) {
          admittedRoots.delete(ref.externalSessionId);
        }
        authorizedRoots = authorizedRoots.filter((root) => !agentSessionRefsEqual(root, ref));
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

    const release = async (): Promise<void> => {
      if (released) {
        return;
      }
      released = true;
      forwardingListener = null;
      const failures: Error[] = [];
      try {
        await releaseEventSessions(eventSessions, runtimeEventTransports);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error("OpenCode cleanup failed."));
      }
      try {
        await observation.release();
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error("OpenCode observation cleanup failed."),
        );
      } finally {
        eventSessions.clear();
        pendingSignals.length = 0;
        pendingSessionSignals.length = 0;
        eventsBeforeSubscribers.length = 0;
      }
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
        admit: async (ref) => {
          admittedRoots.set(ref.externalSessionId, {
            ...ref,
            sessionScope: { kind: "repository" },
          });
          await readSessionSources();
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
