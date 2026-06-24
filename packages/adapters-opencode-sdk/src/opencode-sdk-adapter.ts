import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentCatalogPort,
  AgentEvent,
  AgentModelCatalog,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionRuntimeSnapshot,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentWorkspaceInspectionPort,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListSessionRuntimeSnapshotsInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReadSessionRuntimeSnapshotInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import {
  agentSessionRefsEqual,
  formatWorkflowAgentSessionTitle,
  toAgentSessionRuntimeSnapshot,
  withAgentSessionRef,
} from "@openducktor/core";
import { listAvailableModels, listAvailableSlashCommands, searchFiles } from "./catalog-and-mcp";
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
import { createEventStreamRuntime } from "./event-stream";
import {
  emitAdmittedUserMessage,
  seedHistoryUserMessage,
} from "./event-stream/message-events/user-emitter";
import type { EventStreamRuntime } from "./event-stream/shared";
import {
  applyOpencodeInFlightSendToRuntimeSnapshot,
  findOpencodeLocalRuntimeSnapshot,
  listOpencodeLocalRuntimeSnapshots,
  listOpencodeRuntimeSnapshotSources,
} from "./live-session-snapshots";
import { sendUserMessage } from "./message-execution";
import { loadAndSeedSessionHistory, loadSessionHistory, loadSessionTodos } from "./message-ops";
import { replyApproval, replyQuestion } from "./pending-input-ops";
import {
  type OpencodeRuntimeResolutionInput,
  resolveOpencodeRuntimeClientInput,
} from "./runtime-connection";
import {
  finishUserMessageSend,
  markStreamTurnIdle,
  startUserMessageSend,
} from "./session-activity";
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
  RepoRuntimeResolverPort,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";
import { WORKFLOW_TOOL_CACHE_TTL_MS } from "./types";
import { buildRoleScopedPermissionRules } from "./workflow-tool-permissions";
import {
  ensureTrustedOdtMcpServerConnected,
  resolveWorkflowToolSelection,
} from "./workflow-tool-selection";

const requireWorkflowRole = (session: SessionRecord): AgentRole => {
  if (session.input.role !== null) {
    return session.input.role;
  }
  throw new Error(
    `Session ${session.summary.externalSessionId} is a transcript and cannot send messages.`,
  );
};

const toExistingSessionInput = (input: AgentSessionRef | AgentSessionRuntimeRef): SessionInput =>
  toSessionInput({
    ...input,
    taskId: "taskId" in input ? input.taskId : "",
    role: "role" in input ? input.role : null,
    ...("model" in input && input.model ? { model: input.model } : {}),
    ...("systemPrompt" in input && input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
  });

const applyRuntimeContextToSession = (
  session: SessionRecord,
  input: AgentSessionRuntimeRef,
): void => {
  session.input = { ...session.input };
  session.input.taskId = input.taskId;
  session.input.role = input.role;
  if (input.model !== undefined) {
    if (input.model) {
      session.input.model = input.model;
    } else {
      delete session.input.model;
    }
  }
  if (input.systemPrompt !== undefined) {
    session.input.systemPrompt = input.systemPrompt;
  }
};

const copySubagentCorrelationState = (source: SessionRecord, target: SessionRecord): void => {
  for (const [partId, correlationKey] of source.subagentCorrelationKeyByPartId) {
    target.subagentCorrelationKeyByPartId.set(partId, correlationKey);
  }
  for (const [
    externalSessionId,
    correlationKey,
  ] of source.subagentCorrelationKeyByExternalSessionId) {
    target.subagentCorrelationKeyByExternalSessionId.set(externalSessionId, correlationKey);
  }
  for (const [correlationKey, partId] of source.subagentPartIdByCorrelationKey) {
    target.subagentPartIdByCorrelationKey.set(correlationKey, partId);
  }
  for (const [externalSessionId, partId] of source.subagentPartIdByExternalSessionId) {
    target.subagentPartIdByExternalSessionId.set(externalSessionId, partId);
  }

  target.pendingSubagentCorrelationKeys.splice(
    0,
    target.pendingSubagentCorrelationKeys.length,
    ...source.pendingSubagentCorrelationKeys,
  );
  target.pendingSubagentCorrelationKeysBySignature.clear();
  for (const [signature, pending] of source.pendingSubagentCorrelationKeysBySignature) {
    target.pendingSubagentCorrelationKeysBySignature.set(signature, [...pending]);
  }
};

export class OpencodeSdkAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
  private readonly listeners: SessionEventListeners = new Map();
  private readonly now: () => string;
  private readonly createClient: ClientFactory;
  private readonly repoRuntimeResolver: RepoRuntimeResolverPort | undefined;
  private readonly logEvent: OpencodeEventLogger | undefined;

  constructor(options: OpencodeSdkAdapterOptions = {}) {
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.repoRuntimeResolver = options.repoRuntimeResolver;
    this.logEvent = options.logEvent;
  }

  private async resolveRuntimeClientInput(input: OpencodeRuntimeResolutionInput, action: string) {
    return resolveOpencodeRuntimeClientInput({
      repoRuntimeResolver: this.repoRuntimeResolver,
      input,
      action,
    });
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const runtimeDefinition = this.getRuntimeDefinition();
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "start session");
    const client = this.createClient(runtimeClientInput);
    const created = await client.session.create({
      directory: input.workingDirectory,
      title: formatWorkflowAgentSessionTitle(input.role, input.taskId),
      permission: buildRoleScopedPermissionRules({
        role: input.role,
        runtimeDescriptor: runtimeDefinition,
      }),
    });
    const createdData = unwrapData(created, "create session");
    const externalSessionId = createdData.id;
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Started ${input.role} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary> {
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      return existing.summary;
    }

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "resume session");
    const client = this.createClient(runtimeClientInput);
    const detail = await client.session.get({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
    });
    const detailData = unwrapData(detail, "get session");
    const startedAt = toIsoFromEpoch(
      (detailData as { time?: { created?: unknown } }).time?.created,
      this.now,
    );
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      startedMessage: `Resumed ${input.role} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });
  }

  private async ensureSessionState(
    input: AgentSessionRef | AgentSessionRuntimeRef,
  ): Promise<AgentSessionSummary> {
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      return existing.summary;
    }

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "ensure session state");
    const client = this.createClient(runtimeClientInput);
    const detail = await client.session.get({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
    });
    const detailData = unwrapData(detail, "get session");
    const startedAt = toIsoFromEpoch(
      (detailData as { time?: { created?: unknown } }).time?.created,
      this.now,
    );
    const sessionInput = toExistingSessionInput(input);

    const summary = registerSession({
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
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });

    try {
      const session = requireSession(this.sessions, input.externalSessionId);
      subscribeSessionToRuntimeEvents({
        sessions: this.sessions,
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeId: runtimeClientInput.runtimeId,
        runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput,
        now: this.now,
        emit: this.emit.bind(this),
        ...(this.logEvent ? { logEvent: this.logEvent } : {}),
      });
      const history = await loadAndSeedSessionHistory(this.createClient, this.now, {
        runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        session,
      });
      this.seedRuntimeUserMessagesFromHistory(session, history);
    } catch (error) {
      const session = this.sessions.get(input.externalSessionId);
      if (session) {
        await releaseSessionRuntime(session, this.sessions, this.runtimeEventTransports);
      }
      throw error;
    }

    return summary;
  }

  async releaseSession(input: AgentSessionRef): Promise<void> {
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
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "fork session");
    const client = this.createClient(runtimeClientInput);
    const forked = await client.session.fork({
      directory: input.workingDirectory,
      sessionID: input.parentExternalSessionId,
      ...(input.runtimeHistoryAnchor ? { messageID: input.runtimeHistoryAnchor } : {}),
    });
    const forkedData = unwrapData(forked, "fork session");
    const externalSessionId = forkedData.id;
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeId: runtimeClientInput.runtimeId,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      externalSessionId,
      sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Forked ${input.role} session`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });
  }

  async listSessionRuntimeSnapshots(
    input: ListSessionRuntimeSnapshotsInput,
  ): Promise<AgentSessionRuntimeSnapshot[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      { ...input, workingDirectory: input.repoPath },
      "list session runtime snapshots",
    );
    const snapshots = await listOpencodeRuntimeSnapshotSources({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      now: this.now,
      ...(input.directories ? { directories: input.directories } : {}),
    });
    const existingExternalSessionIds = new Set(
      snapshots.map((snapshot) => snapshot.externalSessionId),
    );
    const localSnapshots = listOpencodeLocalRuntimeSnapshots({
      sessions: this.sessions,
      runtimeId: runtimeClientInput.runtimeId,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      ...(input.directories ? { directories: input.directories } : {}),
      existingExternalSessionIds,
    });
    return [...snapshots, ...localSnapshots].map((snapshot) =>
      toAgentSessionRuntimeSnapshot({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: snapshot.workingDirectory,
          externalSessionId: snapshot.externalSessionId,
        },
        snapshot: applyOpencodeInFlightSendToRuntimeSnapshot({
          sessions: this.sessions,
          runtimeId: runtimeClientInput.runtimeId,
          snapshot,
        }),
      }),
    );
  }

  async readSessionRuntimeSnapshot(
    input: ReadSessionRuntimeSnapshotInput,
  ): Promise<AgentSessionRuntimeSnapshot> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      input,
      "read session runtime snapshot",
    );
    const snapshots = await listOpencodeRuntimeSnapshotSources({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      directories: [input.workingDirectory],
      now: this.now,
    });
    const scannedSnapshot =
      snapshots.find((candidate) => candidate.externalSessionId === input.externalSessionId) ??
      null;
    const localSnapshot = findOpencodeLocalRuntimeSnapshot({
      sessions: this.sessions,
      runtimeId: runtimeClientInput.runtimeId,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      externalSessionId: input.externalSessionId,
    });
    const snapshot = scannedSnapshot ?? localSnapshot;
    if (!snapshot) {
      return toAgentSessionRuntimeSnapshot({
        ref: input,
        snapshot: null,
      });
    }

    const canonicalWorkingDirectory =
      scannedSnapshot?.workingDirectory ??
      localSnapshot?.workingDirectory ??
      input.workingDirectory;
    return toAgentSessionRuntimeSnapshot({
      ref: {
        ...input,
        workingDirectory: canonicalWorkingDirectory,
      },
      snapshot: applyOpencodeInFlightSendToRuntimeSnapshot({
        sessions: this.sessions,
        runtimeId: runtimeClientInput.runtimeId,
        snapshot,
      }),
    });
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "load session history");
    const matchingSessions = [...this.sessions.values()].filter(
      (session) =>
        session.externalSessionId === input.externalSessionId &&
        session.runtimeId === runtimeClientInput.runtimeId,
    );
    const preservedDisplayPartsByMessageId = new Map(
      matchingSessions.flatMap((session) =>
        [...session.messageMetadataById.entries()].flatMap(([messageId, metadata]) =>
          metadata.displayParts ? [[messageId, metadata.displayParts] as const] : [],
        ),
      ),
    );

    const historyInput = {
      ...runtimeClientInput,
      externalSessionId: input.externalSessionId,
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(preservedDisplayPartsByMessageId.size > 0 ? { preservedDisplayPartsByMessageId } : {}),
    };

    if (matchingSessions.length === 0) {
      return loadSessionHistory(this.createClient, this.now, historyInput);
    }

    const [primarySession, ...otherSessions] = matchingSessions;
    if (!primarySession) {
      return loadSessionHistory(this.createClient, this.now, historyInput);
    }

    const history = await loadAndSeedSessionHistory(this.createClient, this.now, {
      ...historyInput,
      session: primarySession,
    });
    this.seedRuntimeUserMessagesFromHistory(primarySession, history);

    for (const session of otherSessions) {
      copySubagentCorrelationState(primarySession, session);
      this.seedRuntimeUserMessagesFromHistory(session, history);
    }

    return history;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    return loadSessionTodos(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "load session todos")),
      externalSessionId: input.externalSessionId,
    });
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    return listAvailableModels(
      this.createClient,
      await this.resolveRuntimeClientInput(
        { ...input, workingDirectory: input.repoPath },
        "list available models",
      ),
    );
  }

  async listAvailableSlashCommands(
    input: import("@openducktor/core").ListAgentSlashCommandsInput,
  ): Promise<import("@openducktor/core").AgentSlashCommandCatalog> {
    return listAvailableSlashCommands(
      this.createClient,
      await this.resolveRuntimeClientInput(
        { ...input, workingDirectory: input.repoPath },
        "list available slash commands",
      ),
    );
  }

  async listAvailableSkills(
    _: import("@openducktor/core").ListAgentSkillsInput,
  ): Promise<import("@openducktor/core").AgentSkillCatalog> {
    throw new Error("OpenCode does not support skill reference catalogs.");
  }

  async searchFiles(
    input: import("@openducktor/core").SearchAgentFilesInput,
  ): Promise<import("@openducktor/core").AgentFileSearchResult[]> {
    return searchFiles(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "search files")),
      query: input.query,
    });
  }

  shouldRestartRuntimeForMcpStatusError(message: string): boolean {
    return /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage> {
    if (!this.sessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = requireSession(this.sessions, input.externalSessionId);
    applyRuntimeContextToSession(session, input);
    startUserMessageSend(session);
    this.emit(input.externalSessionId, {
      type: "session_status",
      externalSessionId: input.externalSessionId,
      timestamp: this.now(),
      status: { type: "busy" },
    });
    try {
      const tools = await this.resolveSessionToolSelection(session);
      const admittedUserMessage = await sendUserMessage({
        session,
        request: input,
        tools,
      });
      const timestamp = this.now();
      const event: AcceptedAgentUserMessage = {
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp,
        ...admittedUserMessage,
      };
      emitAdmittedUserMessage(this.createRuntimeEventView(session), {
        ...admittedUserMessage,
        timestamp,
      });
      return event;
    } catch (error) {
      markStreamTurnIdle(session);
      this.emit(input.externalSessionId, {
        type: "session_idle",
        externalSessionId: input.externalSessionId,
        timestamp: this.now(),
      });
      throw error;
    } finally {
      finishUserMessageSend(session);
    }
  }

  updateSessionModel(input: UpdateAgentSessionModelInput): void {
    const session = requireSession(this.sessions, input.externalSessionId);
    session.input = {
      ...session.input,
      ...(input.model ? { model: input.model } : {}),
    };
    if (!input.model) {
      delete session.input.model;
    }
    delete session.workflowToolSelectionCache;
    delete session.workflowToolSelectionCachedAt;
  }

  async replyApproval(input: ReplyApprovalInput): Promise<void> {
    if (!this.sessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = requireSession(this.sessions, input.externalSessionId);
    applyRuntimeContextToSession(session, input);
    await replyApproval(session, input);
    this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    if (!this.sessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }
    const session = requireSession(this.sessions, input.externalSessionId);
    applyRuntimeContextToSession(session, input);
    await replyQuestion(session, input);
    this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
  }

  async subscribeEvents(
    input: AgentSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe> {
    if (!this.sessions.has(input.externalSessionId)) {
      await this.ensureSessionState(input);
    }

    const session = requireSession(this.sessions, input.externalSessionId);
    const registeredSessionRef = opencodeSessionRef(session);
    if (!agentSessionRefsEqual(registeredSessionRef, input)) {
      throw new Error(
        `Cannot subscribe OpenCode session events for '${input.externalSessionId}' from repo '${input.repoPath}' and working directory '${input.workingDirectory}' because the registered session belongs to repo '${registeredSessionRef.repoPath}' and working directory '${registeredSessionRef.workingDirectory}'.`,
      );
    }
    return subscribeSessionEvents(this.listeners, registeredSessionRef, listener);
  }

  async stopSession(input: AgentSessionRef): Promise<void> {
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
    return loadSessionDiffOp(
      (await this.resolveRuntimeClientInput(input, "load session diff")).runtimeEndpoint,
      input.externalSessionId,
      input.runtimeHistoryAnchor,
    );
  }

  async loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return loadFileStatusOp(
      (await this.resolveRuntimeClientInput(input, "load file status")).runtimeEndpoint,
    );
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

  private createRuntimeEventView(session: SessionRecord): EventStreamRuntime {
    const runtime = createEventStreamRuntime({
      context: {
        externalSessionId: session.externalSessionId,
        input: session.input,
      },
      now: this.now,
      emit: this.emit.bind(this),
      getSession: (sessionId) =>
        sessionId === session.externalSessionId ? session : this.sessions.get(sessionId),
    });
    if (!runtime) {
      throw new Error(
        `Cannot create OpenCode runtime event view for session ${session.externalSessionId}.`,
      );
    }
    return runtime;
  }

  private seedRuntimeUserMessagesFromHistory(
    session: SessionRecord,
    history: AgentSessionHistoryMessage[],
  ): void {
    const runtime = this.createRuntimeEventView(session);
    for (const message of history) {
      if (message.role === "user") {
        seedHistoryUserMessage(runtime, message);
      }
    }
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

  private async resolveSessionToolSelection(
    session: SessionRecord,
  ): Promise<Record<string, boolean>> {
    const nowMs = Date.now();
    await ensureTrustedOdtMcpServerConnected({
      client: session.client,
      workingDirectory: session.input.workingDirectory,
      onReconnectStart: (event) => {
        this.emit(session.summary.externalSessionId, {
          type: "mcp_reconnect_started",
          externalSessionId: session.summary.externalSessionId,
          timestamp: this.now(),
          serverName: event.serverName,
          workingDirectory: event.workingDirectory,
          status: event.status,
          ...(event.errorDetails ? { errorDetails: event.errorDetails } : {}),
        });
      },
    });

    if (
      session.workflowToolSelectionCache &&
      typeof session.workflowToolSelectionCachedAt === "number" &&
      nowMs - session.workflowToolSelectionCachedAt < WORKFLOW_TOOL_CACHE_TTL_MS
    ) {
      return session.workflowToolSelectionCache;
    }

    const selection = await resolveWorkflowToolSelection({
      client: session.client,
      role: requireWorkflowRole(session),
      runtimeDescriptor: this.getRuntimeDefinition(),
      workingDirectory: session.input.workingDirectory,
      skipMcpConnectionCheck: true,
    });

    session.workflowToolSelectionCache = selection;
    session.workflowToolSelectionCachedAt = nowMs;
    return selection;
  }
}
