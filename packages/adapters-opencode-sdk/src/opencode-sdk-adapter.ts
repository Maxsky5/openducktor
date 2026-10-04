import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type AgentSessionControlUpdateTitleInput,
  type AgentSessionScope,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { Session } from "@opencode-ai/sdk/v2/client";
import type {
  AcceptedAgentUserMessage,
  BoundRuntimeRoute,
  AgentCatalogPort,
  AgentEvent,
  AgentFileSearchResult,
  AgentRuntimeCatalogRead,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionRuntimePolicy,
  AgentSessionSummary,
  AgentSessionTitleUpdateResult,
  AgentSessionTodoItem,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ContinueInterruptedAgentTurnInput,
  ForkAgentSessionInput,
  LoadAgentRuntimeCatalogInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  PolicyBoundSessionRef,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  AgentRuntimeQueryError,
  assertAgentRuntimeQuerySession,
  agentSessionRefsEqual,
  assertAgentRuntimePolicyBinding,
  withSummaryTitle,
  classifySystemSlashCommandInvocation,
  interruptedTurnResumeError,
  withAgentSessionRef,
} from "@openducktor/core";
import { loadRuntimeCatalog, searchFiles } from "./catalog-and-mcp";
import { buildCreationPermissions } from "./opencode-creation-permissions";
import { PERMISSION_METADATA_KEY, unownedPermissionRules } from "./opencode-permission-ownership";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { unwrapData } from "./data-utils";
import {
  loadFileStatus as loadFileStatusOp,
  loadSessionDiff as loadSessionDiffOp,
} from "./diff-ops";
import {
  clearSessionListeners,
  emitSessionEvent,
  type SessionEventListeners,
  subscribeSessionEvents,
} from "./event-emitter";
import { sendUserMessage, usesPromptAsyncTransport } from "./message-execution";
import {
  continueOpencodeInterruptedTurn,
  probeOpencodeInterruptedTurn,
  toOpencodeInterruptedTurnResumeError,
  toOpencodeSessionNotFoundResumeError,
} from "./opencode-interrupted-turn";
import { loadSessionHistory, loadSessionTodos } from "./message-ops";
import { normalizeModelInput } from "./payload-mappers";
import { createOpenCodeMessageId } from "./opencode-message-id";
import {
  applySessionContext,
  assertSessionRef,
  assertSessionScope,
  setSessionTitle,
  getBoundSession,
  restoreSessionPolicy,
} from "./opencode-session-binding";
import {
  createSessionPermissionRestorer,
  type SessionPermissionRestorer,
  resolvePermissionOwnership,
  readPermissionSession,
  appendSessionPermissions,
  checkSessionPermissions,
  assertTurnPermissionsReady,
} from "./opencode-session-permissions";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import {
  beginOpencodeUserMessageSend,
  completeOpencodeUserMessageSend,
  failOpencodeUserMessageSend,
  projectAdmittedOpencodeUserMessage,
} from "./opencode-agent-session-projection";
import { opencodeSessionDetailPayloadSchema, type ParsedOpencodeSession } from "./opencode-ingress";
import { replyApproval, replyQuestion } from "./pending-input-ops";
import { toOpenCodeRequestError } from "./request-errors";
import {
  type OpencodeRuntimeResolutionInput,
  type ResolvedOpencodeRuntimeClientInput,
  resolveOpencodeRuntimeClientInput,
} from "./runtime-connection";
import { opencodeSessionRef } from "./session-ref";
import {
  registerSession,
  releaseSessionRuntime,
  requireSession,
  stopSessionRuntime,
  subscribeSessionToRuntimeEvents,
} from "./session-registry";
import { toIsoFromEpoch, toSessionInput } from "./session-runtime-utils";
import type {
  ClientFactory,
  OpencodeEventLogger,
  OpencodeSdkAdapterOptions,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";
import { waitForUserMessageAdmission } from "./user-message-admission";
import type {
  OpencodeMcpDirectoryBindings,
  OpencodeMcpReconnectEvent,
} from "./opencode-mcp-bindings";

const toExistingSessionInput = (input: PolicyBoundSessionRef): SessionInput => {
  return toSessionInput(input);
};

const assertOpenCodeRuntimePolicyBinding = (
  input: { runtimeKind: RuntimeKind; runtimePolicy: AgentSessionRuntimePolicy },
  action: string,
): void => {
  assertAgentRuntimePolicyBinding(input, action);
  if (input.runtimeKind !== "opencode") {
    throw new Error(`Cannot ${action} for non-OpenCode runtime '${input.runtimeKind}'.`);
  }
};

export class OpencodeSdkAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly resolveCreationSettings: OpencodeSdkAdapterOptions["resolveCreationSettings"];
  private readonly restorePermissions: SessionPermissionRestorer;
  private readonly sessions: Map<string, SessionRecord>;
  private readonly runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
  private readonly listeners: SessionEventListeners = new Map();
  private readonly now: () => string;
  private readonly createClient: ClientFactory;
  private readonly runtime: BoundRuntimeRoute;
  private readonly mcpBindings: OpencodeMcpDirectoryBindings | undefined;
  private readonly logEvent: OpencodeEventLogger | undefined;

  constructor(
    options: OpencodeSdkAdapterOptions,
    runtimeState?: {
      sessions: Map<string, SessionRecord>;
      runtimeEventTransports: Map<string, RuntimeEventTransportRecord>;
      restorePermissions?: SessionPermissionRestorer;
    },
  ) {
    this.resolveCreationSettings = options.resolveCreationSettings;
    this.restorePermissions = runtimeState?.restorePermissions ?? createSessionPermissionRestorer();
    this.sessions = runtimeState?.sessions ?? new Map();
    this.runtimeEventTransports = runtimeState?.runtimeEventTransports ?? new Map();
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.runtime = options.runtime;
    this.mcpBindings = options.mcpBindings;
    this.logEvent = options.logEvent;
  }

  private resolveRuntimeClientInput(input: OpencodeRuntimeResolutionInput, action: string) {
    return resolveOpencodeRuntimeClientInput({
      runtime: this.runtime,
      input,
      action,
    });
  }

  /**
   * Resolves a session client without registering the session, so the continuation probe
   * can refuse an ineligible turn before the adapter attaches to the runtime session.
   */
  private async resolveContinuationProbeClient(input: ContinueInterruptedAgentTurnInput) {
    const runtimeClientInput = this.resolveRuntimeClientInput(input, "continue OpenCode turn");
    const client = this.createClient(runtimeClientInput);
    await this.ensureMcpBinding(client, input);
    return client;
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "start OpenCode session");
    const runtimeDefinition = this.getRuntimeDefinition();
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      runtimeDefinition,
      "start OpenCode session",
    );
    const settings = structuredClone(await this.resolveCreationSettings(input.sessionScope!));
    const runtimeClientInput = this.resolveRuntimeClientInput(input, "start session");
    const client = this.createClient(runtimeClientInput);
    await this.ensureMcpBinding(client, input);
    const creation = await buildCreationPermissions({
      settings,
      policy,
      native: [],
      client,
      workingDirectory: input.workingDirectory,
    });
    const createRequest: Parameters<typeof client.session.create>[0] = {
      directory: input.workingDirectory,
      permission: creation.permission,
      metadata: { [PERMISSION_METADATA_KEY]: creation.ownership },
    };
    if (policy.title !== undefined) {
      createRequest.title = policy.title;
    }
    const createAction = `create permissions for OpenCode session in '${input.workingDirectory}'. Reconnect the selected OpenCode runtime and retry; update OpenCode if its permission API is unsupported`;
    let created: Session;
    try {
      created = unwrapData(await client.session.create(createRequest), createAction);
    } catch (error) {
      throw toOpenCodeRequestError(createAction, error);
    }
    const id = opencodeSessionDetailPayloadSchema.shape.id
      .refine((value) => value.trim().length > 0)
      .safeParse(created.id);
    if (!id.success) {
      throw toOpenCodeRequestError(
        createAction,
        new Error("The native create response has no usable session ID."),
      );
    }
    const externalSessionId = id.data;
    try {
      checkSessionPermissions(
        created,
        input.workingDirectory,
        externalSessionId,
        creation.permission,
        creation.ownership,
      );
    } catch (error) {
      return this.deleteUnregisteredSession(
        { client, externalSessionId, workingDirectory: input.workingDirectory },
        toOpenCodeRequestError(createAction, error),
      );
    }
    const sessionInput = toSessionInput(input);

    const registrationInput: Parameters<typeof registerSession>[0] = {
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Started ${policy.scope.kind === "workflow" ? policy.scope.role : "repository"} session`,
      now: this.now,
      emit: this.emit.bind(this),
    };
    if (this.logEvent) {
      registrationInput.logEvent = this.logEvent;
    }
    return registerSession(registrationInput);
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "resume OpenCode session");
    const runtimeDefinition = this.getRuntimeDefinition();
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      runtimeDefinition,
      "resume OpenCode session",
    );
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      const registeredSessionRef = opencodeSessionRef(existing);
      if (!agentSessionRefsEqual(registeredSessionRef, input)) {
        throw new Error(
          `Cannot resume OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
        );
      }
      await restoreSessionPolicy({
        action: "resume session",
        policy,
        request: input,
        session: existing,
        restorePermissions: this.restorePermissions,
        ensureMcpBinding: () => this.ensureMcpBinding(existing.client, input),
      });
      return existing.summary;
    }

    const runtimeClientInput = this.resolveRuntimeClientInput(input, "resume session");
    const client = this.createClient(runtimeClientInput);
    await this.ensureMcpBinding(client, input);
    const detailRecord = await this.restorePermissions({
      client,
      externalSessionId: input.externalSessionId,
      policy,
      workingDirectory: input.workingDirectory,
    });
    const title = await setSessionTitle({
      client,
      externalSessionId: input.externalSessionId,
      title: policy.title,
      workingDirectory: input.workingDirectory,
    });
    const startedAt = toIsoFromEpoch(detailRecord.time.created, this.now);
    const sessionInput = toSessionInput(input);
    const registrationInput: Parameters<typeof registerSession>[0] = {
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      startedMessage: `Resumed ${policy.scope.kind === "workflow" ? policy.scope.role : "repository"} session`,
      now: this.now,
      emit: this.emit.bind(this),
    };
    if (this.logEvent) {
      registrationInput.logEvent = this.logEvent;
    }
    const summary = registerSession(registrationInput);
    summary.title = title ?? detailRecord.title;
    return summary;
  }

  async continueInterruptedTurn(
    input: ContinueInterruptedAgentTurnInput,
  ): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "continue OpenCode turn");
    resolveOpencodeSessionPolicy(
      input.sessionScope,
      this.getRuntimeDefinition(),
      "continue OpenCode turn",
    );
    const registered = this.sessions.get(input.externalSessionId);
    if (registered) {
      const registeredRef = opencodeSessionRef(registered);
      if (!agentSessionRefsEqual(registeredRef, input)) {
        throw interruptedTurnResumeError({
          reason: "identity_mismatch",
          message: `OpenCode session '${input.externalSessionId}' is registered to repo '${registeredRef.repoPath}' and working directory '${registeredRef.workingDirectory}'.`,
        });
      }
      assertSessionScope(registered, input, "continue OpenCode turn", (message) =>
        interruptedTurnResumeError({ reason: "identity_mismatch", message }),
      );
    }
    // Probe with an unregistered session client so an ineligible turn never registers,
    // subscribes, or emits a started event for the session.
    const probeClient = registered
      ? registered.client
      : await this.resolveContinuationProbeClient(input);

    let probe: Awaited<ReturnType<typeof probeOpencodeInterruptedTurn>>;
    try {
      probe = await probeOpencodeInterruptedTurn({
        client: probeClient,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
      });
    } catch (error) {
      throw (
        toOpencodeSessionNotFoundResumeError(
          error instanceof Error ? error : null,
          input.externalSessionId,
        ) ??
        interruptedTurnResumeError({
          reason: "probe_failed",
          message: `Cannot read the OpenCode turn state for session '${input.externalSessionId}': ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        })
      );
    }
    if (probe.kind !== "unfinished_turn") {
      throw toOpencodeInterruptedTurnResumeError(probe, input.externalSessionId);
    }

    try {
      await this.resumeSession(input);
    } catch (error) {
      const notFound = toOpencodeSessionNotFoundResumeError(
        error instanceof Error ? error : null,
        input.externalSessionId,
      );
      if (notFound) {
        throw notFound;
      }
      throw error;
    }
    const session = requireSession(this.sessions, input.externalSessionId);

    const begunSend = beginOpencodeUserMessageSend({
      session,
      expectsPromptTurnStart: true,
      isManualSessionCompaction: false,
      timestamp: this.now(),
    });
    this.emit(input.externalSessionId, begunSend.runningEvent);
    try {
      await this.ensureSessionMcpBinding(session);
      assertTurnPermissionsReady(session);
      const modelInput = normalizeModelInput(input.model ?? session.input.model);
      const continuationInput = {
        client: session.client,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        modelInput,
      };
      await continueOpencodeInterruptedTurn(
        session.input.systemPrompt.trim().length > 0
          ? { ...continuationInput, systemPrompt: session.input.systemPrompt }
          : continuationInput,
      );
    } catch (error) {
      const idleEvent = failOpencodeUserMessageSend(session, false, this.now());
      if (idleEvent && this.sessions.get(input.externalSessionId) === session) {
        this.emit(input.externalSessionId, idleEvent);
      }
      throw (
        toOpencodeSessionNotFoundResumeError(
          error instanceof Error ? error : null,
          input.externalSessionId,
        ) ??
        interruptedTurnResumeError({
          reason: "continuation_failed",
          message: `OpenCode could not continue the interrupted turn for session '${input.externalSessionId}': ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        })
      );
    } finally {
      completeOpencodeUserMessageSend(session);
    }

    return session.summary;
  }

  async observeRegisteredSession(input: {
    repoPath: string;
    workingDirectory: string;
    externalSessionId: string;
    detail: ParsedOpencodeSession;
  }): Promise<AgentSessionSummary> {
    const sessionRef: PolicyBoundSessionRef = {
      repoPath: input.repoPath,
      workingDirectory: input.workingDirectory,
      externalSessionId: input.externalSessionId,
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
    };
    return this.ensureSessionState(sessionRef, input.detail);
  }

  private async ensureSessionState(
    input: PolicyBoundSessionRef,
    knownDetail?: ParsedOpencodeSession,
  ): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "ensure OpenCode session state");
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      const registeredSessionRef = opencodeSessionRef(existing);
      if (!agentSessionRefsEqual(registeredSessionRef, input)) {
        throw new Error(
          `Cannot ensure OpenCode session state for '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
        );
      }
      if (input.sessionScope) {
        await restoreSessionPolicy({
          action: "ensure session state",
          policy: resolveOpencodeSessionPolicy(
            input.sessionScope,
            this.getRuntimeDefinition(),
            "ensure OpenCode session state",
          ),
          request: input,
          session: existing,
          restorePermissions: this.restorePermissions,
          ensureMcpBinding: () => this.ensureMcpBinding(existing.client, input),
        });
      } else {
        applySessionContext(existing, input, "ensure session state");
      }
      return existing.summary;
    }

    const runtimeClientInput = this.resolveRuntimeClientInput(input, "ensure session state");
    const client = this.createClient(runtimeClientInput);
    const policy = input.sessionScope
      ? resolveOpencodeSessionPolicy(
          input.sessionScope,
          this.getRuntimeDefinition(),
          "ensure OpenCode session state",
        )
      : null;
    if (policy) {
      await this.ensureMcpBinding(client, input);
    }
    if (knownDetail) {
      if (
        knownDetail.id !== input.externalSessionId ||
        knownDetail.directory !== input.workingDirectory
      ) {
        throw new Error(
          `Cannot observe OpenCode session '${input.externalSessionId}' in '${input.workingDirectory}' from detail '${knownDetail.id}' in '${knownDetail.directory}'.`,
        );
      }
    }
    let detailRecord: ParsedOpencodeSession;
    if (policy) {
      detailRecord = await this.restorePermissions({
        client,
        externalSessionId: input.externalSessionId,
        policy,
        workingDirectory: input.workingDirectory,
      });
    } else if (knownDetail) {
      detailRecord = knownDetail;
    } else {
      detailRecord = await readPermissionSession({
        client,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
      });
    }
    const title = policy
      ? await setSessionTitle({
          client,
          externalSessionId: input.externalSessionId,
          title: policy.title,
          workingDirectory: input.workingDirectory,
        })
      : null;
    const startedAt = toIsoFromEpoch(detailRecord.time.created, this.now);
    const sessionInput = toExistingSessionInput(input);

    const registrationInput: Parameters<typeof registerSession>[0] = {
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      emitStartedEvent: false,
      subscribeToEvents: false,
      now: this.now,
      emit: this.emit.bind(this),
    };
    if (this.logEvent) {
      registrationInput.logEvent = this.logEvent;
    }
    const summary = registerSession(registrationInput);
    summary.title = title ?? detailRecord.title;

    try {
      const subscriptionInput: Parameters<typeof subscribeSessionToRuntimeEvents>[0] = {
        sessions: this.sessions,
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeId: runtimeClientInput.runtimeId,
        runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput,
        now: this.now,
        emit: this.emit.bind(this),
      };
      if (this.logEvent) {
        subscriptionInput.logEvent = this.logEvent;
      }
      subscribeSessionToRuntimeEvents(subscriptionInput);
    } catch (error) {
      const session = this.sessions.get(input.externalSessionId);
      if (session) {
        await releaseSessionRuntime(session, this.sessions, this.runtimeEventTransports);
      }
      throw error;
    }

    return summary;
  }

  private policyBoundSessionState(
    input: PolicyBoundSessionRef,
    action: string,
  ): SessionRecord | Promise<SessionRecord> {
    return getBoundSession({
      request: input,
      action,
      session: this.sessions.get(input.externalSessionId),
      bindSession: async () => {
        await this.ensureSessionState(input);
        return requireSession(this.sessions, input.externalSessionId);
      },
    });
  }

  async releaseSession(input: SessionRef): Promise<void> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      clearSessionListeners(this.listeners, input);
      return;
    }
    const sessionRef = opencodeSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot release OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    await releaseSessionRuntime(session, this.sessions, this.runtimeEventTransports);
    clearSessionListeners(this.listeners, sessionRef);
  }

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    assertOpenCodeRuntimePolicyBinding(input, "fork OpenCode session");
    const policy = resolveOpencodeSessionPolicy(
      input.sessionScope,
      this.getRuntimeDefinition(),
      "fork OpenCode session",
    );
    const settings = structuredClone(await this.resolveCreationSettings(input.sessionScope!));
    const runtimeClientInput = this.resolveRuntimeClientInput(input, "fork session");
    const client = this.createClient(runtimeClientInput);
    await this.ensureMcpBinding(client, input);
    // The fork uses this source snapshot. Later native permission changes do not alter the captured rules.
    const source = await readPermissionSession({
      client,
      externalSessionId: input.parentExternalSessionId,
      workingDirectory: input.workingDirectory,
    });
    const ownership = await resolvePermissionOwnership(client, source);
    const native = unownedPermissionRules(source.permission ?? [], ownership);
    const creation = await buildCreationPermissions({
      settings,
      policy,
      native,
      client,
      workingDirectory: input.workingDirectory,
    });
    const forkRequest: Parameters<typeof client.session.fork>[0] = {
      directory: input.workingDirectory,
      sessionID: input.parentExternalSessionId,
    };
    if (input.runtimeHistoryAnchor) {
      forkRequest.messageID = input.runtimeHistoryAnchor;
    }
    const forked = await client.session.fork(forkRequest);
    const forkedData = unwrapData(forked, "fork session");
    const externalSessionId = forkedData.id;
    if (!externalSessionId)
      throw toOpenCodeRequestError(
        `fork OpenCode session '${input.parentExternalSessionId}' in '${input.workingDirectory}'. Reconnect the selected OpenCode runtime and retry`,
        new Error("The native fork response has no session ID."),
      );
    try {
      const detail = checkSessionPermissions(forkedData, input.workingDirectory, externalSessionId);
      if ((detail.permission?.length ?? 0) !== 0)
        throw new Error(
          "The native fork unexpectedly contains permissions. Update the selected OpenCode runtime.",
        );
      await appendSessionPermissions({
        client,
        detail,
        permission: creation.permission,
        ownership: creation.ownership,
      });
      await setSessionTitle({
        client,
        externalSessionId,
        workingDirectory: input.workingDirectory,
        title: policy.title,
      });
    } catch (policyError) {
      return this.deleteUnregisteredSession(
        { client, externalSessionId, workingDirectory: input.workingDirectory },
        toOpenCodeRequestError(
          `apply ${policy.scope.kind} policy to forked OpenCode session '${externalSessionId}' in '${input.workingDirectory}'`,
          policyError,
        ),
      );
    }
    const sessionInput = toSessionInput(input);

    const registrationInput: Parameters<typeof registerSession>[0] = {
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Forked ${policy.scope.kind === "workflow" ? policy.scope.role : "repository"} session`,
      now: this.now,
      emit: this.emit.bind(this),
    };
    if (this.logEvent) {
      registrationInput.logEvent = this.logEvent;
    }
    return registerSession(registrationInput);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    assertOpenCodeRuntimePolicyBinding(input, "load OpenCode session history");
    const runtimeClientInput = this.resolveRuntimeClientInput(input, "load session history");
    const session = await this.querySession(input, runtimeClientInput);
    const preservedDisplayPartsByMessageId = new Map(
      [...(session?.messageMetadataById ?? [])].flatMap(([messageId, metadata]) =>
        metadata.displayParts ? [[messageId, metadata.displayParts] as const] : [],
      ),
    );

    const historyInput: Parameters<typeof loadSessionHistory>[2] = {
      ...runtimeClientInput,
      externalSessionId: input.externalSessionId,
    };
    if (input.limit !== undefined) {
      historyInput.limit = input.limit;
    }
    if (preservedDisplayPartsByMessageId.size > 0) {
      historyInput.preservedDisplayPartsByMessageId = preservedDisplayPartsByMessageId;
    }

    return loadSessionHistory(this.createClient, this.now, historyInput);
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    assertOpenCodeRuntimePolicyBinding(input, "load OpenCode session todos");
    const runtime = this.resolveRuntimeClientInput(input, "load session todos");
    await this.querySession(input, runtime);
    return loadSessionTodos(this.createClient, {
      ...runtime,
      externalSessionId: input.externalSessionId,
    });
  }

  async resolveSessionParent(input: SessionRef): Promise<string | null> {
    const runtime = this.resolveRuntimeClientInput(input, "read session parent");
    const target = await this.readSession(input, runtime, "read session parent");
    return target.parentID || null;
  }

  async loadRuntimeCatalog(input: LoadAgentRuntimeCatalogInput): Promise<AgentRuntimeCatalogRead> {
    const runtimeClientInput = this.resolveRuntimeClientInput(input, "load runtime catalog");
    return loadRuntimeCatalog(this.createClient, {
      ...runtimeClientInput,
      repoPath: input.repoPath,
    });
  }

  async searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]> {
    return searchFiles(this.createClient, {
      ...this.resolveRuntimeClientInput(input, "search files"),
      query: input.query,
    });
  }

  shouldRestartRuntimeForMcpStatusError(message: string): boolean {
    return /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage> {
    assertOpenCodeRuntimePolicyBinding(input, "send OpenCode user message");
    resolveOpencodeSessionPolicy(
      input.sessionScope,
      this.getRuntimeDefinition(),
      "send OpenCode user message",
    );
    let systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>;
    try {
      systemInvocation = classifySystemSlashCommandInvocation(input.parts);
    } catch (error) {
      throw toOpenCodeRequestError("compact session", error);
    }
    const existing = this.sessions.get(input.externalSessionId);
    if (existing?.permissionSetupError || existing?.permissionSetupInFlight) {
      assertSessionRef(existing, input, "send");
      assertSessionScope(existing, input, "send");
      assertTurnPermissionsReady(existing);
    }
    const session = this.policyBoundSessionState(input, "send");
    return session instanceof Promise
      ? session.then((boundSession) =>
          this.sendUserMessageFromBoundSession(input, boundSession, systemInvocation),
        )
      : this.sendUserMessageFromBoundSession(input, session, systemInvocation);
  }

  private async sendUserMessageFromBoundSession(
    input: SendAgentUserMessageInput,
    session: SessionRecord,
    systemInvocation: ReturnType<typeof classifySystemSlashCommandInvocation>,
  ): Promise<AcceptedAgentUserMessage> {
    const expectsPromptTurnStart = usesPromptAsyncTransport(input.parts);
    const waitsForRuntimeAdmission =
      systemInvocation.kind === "not_system" && !expectsPromptTurnStart;
    const messageId = waitsForRuntimeAdmission ? createOpenCodeMessageId() : undefined;
    const admission = messageId ? waitForUserMessageAdmission(session, messageId) : undefined;
    const begunSend = beginOpencodeUserMessageSend({
      session,
      expectsPromptTurnStart,
      isManualSessionCompaction: systemInvocation.kind === "manual_session_compaction",
      timestamp: this.now(),
    });
    this.emit(input.externalSessionId, begunSend.runningEvent);
    try {
      if (systemInvocation.kind !== "manual_session_compaction") {
        await this.ensureSessionMcpBinding(session);
      }
      const sendInput: Parameters<typeof sendUserMessage>[0] = {
        session,
        request: input,
      };
      if (messageId) {
        sendInput.messageId = messageId;
      }
      if (admission) {
        sendInput.admission = admission.promise;
      }
      const admittedUserMessage = await sendUserMessage(sendInput);
      const timestamp = this.now();
      const event: AcceptedAgentUserMessage = {
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp,
        ...admittedUserMessage,
      };
      if (systemInvocation.kind !== "manual_session_compaction") {
        projectAdmittedOpencodeUserMessage({
          externalSessionId: session.externalSessionId,
          input: session.input,
          session,
          now: this.now,
          emit: this.emit.bind(this),
          message: {
            ...admittedUserMessage,
            timestamp,
          },
        });
      }
      return event;
    } catch (error) {
      const idleEvent = failOpencodeUserMessageSend(
        session,
        begunSend.preserveActiveTurnOnFailure,
        this.now(),
      );
      if (idleEvent && this.sessions.get(input.externalSessionId) === session) {
        this.emit(input.externalSessionId, idleEvent);
      }
      throw error;
    } finally {
      admission?.dispose();
      completeOpencodeUserMessageSend(session);
    }
  }

  async updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    const nextInput: SessionInput = { ...session.input };
    if (input.model) {
      const profileId = input.model.profileId ?? session.input.model?.profileId;
      nextInput.model = profileId ? { ...input.model, profileId } : input.model;
    } else {
      delete nextInput.model;
    }
    session.input = nextInput;
  }

  async updateSessionTitle(
    input: AgentSessionControlUpdateTitleInput,
  ): Promise<AgentSessionTitleUpdateResult> {
    const session = this.sessions.get(input.externalSessionId);
    if (!session) {
      return { status: "not_attached" };
    }
    assertSessionRef(session, input, "rename");
    const action = `rename OpenCode session '${input.externalSessionId}'`;
    try {
      const updated = await session.client.session.update({
        directory: input.workingDirectory,
        sessionID: input.externalSessionId,
        title: input.title,
      });
      unwrapData(updated, action);
    } catch (error) {
      throw toOpenCodeRequestError(action, error);
    }
    session.summary = withSummaryTitle(session.summary, input.title);
    return { status: "renamed", summary: session.summary };
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    assertOpenCodeRuntimePolicyBinding(input, "reply to OpenCode approval");
    const reply = async (session: SessionRecord) => {
      await replyApproval(session, input);
      this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
    };
    const session = this.policyBoundSessionState(input, "reply to approval for");
    return session instanceof Promise ? session.then(reply) : reply(session);
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    assertOpenCodeRuntimePolicyBinding(input, "reply to OpenCode question");
    const reply = async (session: SessionRecord) => {
      await replyQuestion(session, input);
      this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
    };
    const session = this.policyBoundSessionState(input, "reply to question for");
    return session instanceof Promise ? session.then(reply) : reply(session);
  }

  async subscribeEvents(
    input: PolicyBoundSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe> {
    assertOpenCodeRuntimePolicyBinding(input, "subscribe OpenCode session events");
    const subscribe = (session: SessionRecord) =>
      subscribeSessionEvents(this.listeners, opencodeSessionRef(session), listener);
    const session = this.policyBoundSessionState(input, "subscribe to events for");
    return session instanceof Promise ? session.then(subscribe) : subscribe(session);
  }

  async stopSession(input: SessionRef): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    const sessionRef = opencodeSessionRef(session);
    if (!agentSessionRefsEqual(sessionRef, input)) {
      throw new Error(
        `Cannot stop OpenCode session '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${sessionRef.repoPath}' and working directory '${sessionRef.workingDirectory}'.`,
      );
    }

    await stopSessionRuntime(session, this.sessions, this.runtimeEventTransports);

    emitSessionEvent(
      this.listeners,
      sessionRef,
      withAgentSessionRef(sessionRef, {
        type: "session_finished",
        externalSessionId: input.externalSessionId,
        timestamp: this.now(),
        message: "Session stopped",
      }),
    );
    clearSessionListeners(this.listeners, sessionRef);
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    const runtime = this.resolveRuntimeClientInput(input, "load session diff");
    await this.querySession(input, runtime);
    return loadSessionDiffOp(
      runtime.runtimeEndpoint,
      input.externalSessionId,
      input.workingDirectory,
      input.runtimeHistoryAnchor,
    );
  }

  async loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return loadFileStatusOp(
      this.resolveRuntimeClientInput(input, "load file status").runtimeEndpoint,
      input.workingDirectory,
    );
  }

  /** Delete a new session before returning its setup failure. Keep both errors if cleanup fails. */
  private async deleteUnregisteredSession(
    input: {
      client: SessionRecord["client"];
      externalSessionId: string;
      workingDirectory: string;
    },
    setupError: Error,
  ): Promise<never> {
    try {
      const deleted = await input.client.session.delete({
        directory: input.workingDirectory,
        sessionID: input.externalSessionId,
      });
      if (deleted.error || deleted.data !== true) {
        throw toOpenCodeRequestError(
          `delete unregistered OpenCode session '${input.externalSessionId}' in '${input.workingDirectory}'`,
          deleted.error,
          deleted.response,
        );
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        `OpenCode session '${input.externalSessionId}' in '${input.workingDirectory}' failed setup and could not be deleted: ${String(setupError)}; ${String(cleanupError)}. Delete the unused session in OpenCode before retrying.`,
      );
    }
    throw setupError;
  }

  private emit(externalSessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      if (event.sessionRef) {
        emitSessionEvent(this.listeners, event.sessionRef, event);
        return;
      }
      throw new Error(
        `Cannot emit OpenCode session event for missing session '${externalSessionId}'.`,
      );
    }
    const sessionRef = opencodeSessionRef(session);
    emitSessionEvent(this.listeners, sessionRef, withAgentSessionRef(sessionRef, event));
  }

  private clearPendingSubagentInputEvent(externalSessionId: string, requestId: string): void {
    for (const session of this.sessions.values()) {
      const pending = session.pendingSubagentInputEventsByExternalSessionId.get(externalSessionId);
      if (!pending) {
        continue;
      }

      const nextPending = pending.filter((event) => event.requestId !== requestId);
      if (nextPending.length === pending.length) {
        continue;
      }
      if (nextPending.length === 0) {
        session.pendingSubagentInputEventsByExternalSessionId.delete(externalSessionId);
        continue;
      }
      session.pendingSubagentInputEventsByExternalSessionId.set(externalSessionId, nextPending);
    }
  }

  /**
   * Binds the OpenDucktor MCP server of the owning workspace to the directory. Fails when this
   * adapter has no MCP bindings, because workflow tools need them.
   */
  private async ensureMcpBinding(
    client: SessionRecord["client"],
    input: { repoPath: string; workingDirectory: string },
    onReconnectStart?: (event: OpencodeMcpReconnectEvent) => void,
  ): Promise<void> {
    if (!this.mcpBindings) {
      throw new Error(
        `ODT workflow tools unavailable for "${input.workingDirectory}": the OpenCode adapter has no OpenDucktor MCP binding. Restart the OpenCode runtime from Diagnostics and retry.`,
      );
    }
    await this.mcpBindings.ensure({
      client,
      repoPath: input.repoPath,
      workingDirectory: input.workingDirectory,
      onReconnectStart,
    });
  }

  /** Binds the session directory and emits `mcp_reconnect_started` when it must reconnect. */
  private async ensureSessionMcpBinding(session: SessionRecord): Promise<void> {
    await this.ensureMcpBinding(session.client, session.input, (event) => {
      const reconnectEvent: AgentEvent = {
        type: "mcp_reconnect_started",
        externalSessionId: session.summary.externalSessionId,
        timestamp: this.now(),
        serverName: event.serverName,
        workingDirectory: event.workingDirectory,
        status: event.status,
      };
      if (event.errorDetails) {
        reconnectEvent.errorDetails = event.errorDetails;
      }
      this.emit(session.summary.externalSessionId, reconnectEvent);
    });
  }

  private async querySession(
    input: SessionRef & { sessionScope?: AgentSessionScope | undefined },
    runtime: ResolvedOpencodeRuntimeClientInput,
  ): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(input.externalSessionId);
    if (session) {
      assertAgentRuntimeQuerySession(
        { ...input, workingDirectory: runtime.workingDirectory },
        opencodeSessionRef(session),
        session.summary.sessionAssociation,
      );
      if (session.runtimeId !== runtime.runtimeId) {
        throw new AgentRuntimeQueryError(
          "runtime_unavailable",
          "The session belongs to a replaced runtime. Reload the runtime data.",
        );
      }
      return session;
    }
    await this.readSession(input, runtime, "read session identity");
    return undefined;
  }

  private async readSession(
    input: SessionRef,
    runtime: ResolvedOpencodeRuntimeClientInput,
    operation: string,
  ): Promise<ParsedOpencodeSession> {
    const response = await this.createClient(runtime).session.get({
      sessionID: input.externalSessionId,
      directory: runtime.workingDirectory,
    });
    const target = opencodeSessionDetailPayloadSchema.parse(unwrapData(response, operation));
    if (target.id !== input.externalSessionId || target.directory !== runtime.workingDirectory) {
      throw new AgentRuntimeQueryError(
        "scope_mismatch",
        "The native session does not match the selected session and working directory. Select the matching session.",
      );
    }
    return target;
  }
}
