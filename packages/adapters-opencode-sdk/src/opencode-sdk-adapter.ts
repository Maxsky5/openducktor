import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentEvent,
  AgentModelCatalog,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionPort,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentWorkspaceInspectionPort,
  AttachAgentSessionInput,
  EventUnsubscribe,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListLiveAgentSessionsInput,
  ListLiveSessionTruthInput,
  LiveAgentSessionSummary,
  LiveSessionTruth,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReadLiveSessionTruthInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import { toLiveSessionTruthFromSnapshot } from "@openducktor/core";
import {
  connectMcpServer,
  getMcpStatus,
  listAvailableModels,
  listAvailableSlashCommands,
  listAvailableToolIds,
  searchFiles,
} from "./catalog-and-mcp";
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
import { setSessionIdle } from "./event-stream/shared";
import { listOpencodeLiveAgentSessionSnapshots } from "./live-session-snapshots";
import { sendUserMessage } from "./message-execution";
import {
  loadAndSeedSessionHistory,
  loadSessionHistory,
  loadSessionTodos,
  replyApproval,
  replyQuestion,
} from "./message-ops";
import {
  type OpencodeRuntimeResolutionInput,
  toOpencodeRuntimeClientInput,
} from "./runtime-connection";
import {
  attachSessionToRuntimeEvents,
  clearWorkflowToolCacheForDirectory,
  detachSessionRuntime,
  hasSession,
  registerSession,
  requireSession,
  stopSessionRuntime,
} from "./session-registry";
import { toIsoFromEpoch, toSessionInput } from "./session-runtime-utils";
import type {
  ClientFactory,
  McpServerStatus,
  OpencodeEventLogger,
  OpencodeSdkAdapterOptions,
  RepoRuntimeResolverPort,
  RuntimeEventTransportRecord,
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

  private async resolveRuntimeClientInput(
    input: OpencodeRuntimeResolutionInput,
    action: string,
    options: { requireLive?: boolean } = {},
  ) {
    if (!this.repoRuntimeResolver) {
      throw new Error(
        `Repo runtime resolver is required to ${action} for repo '${input.repoPath}' and runtime '${input.runtimeKind}'.`,
      );
    }
    const runtimeRef = {
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
    };
    const runtime = options.requireLive
      ? await this.repoRuntimeResolver.requireRepoRuntime(runtimeRef)
      : await this.repoRuntimeResolver.ensureRepoRuntime(runtimeRef);
    return toOpencodeRuntimeClientInput({
      runtime,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      action,
    });
  }

  private async resolveRuntimeClientInputWithRuntimeId(
    input: OpencodeRuntimeResolutionInput,
    action: string,
    options: { requireLive?: boolean } = {},
  ) {
    if (!this.repoRuntimeResolver) {
      throw new Error(
        `Repo runtime resolver is required to ${action} for repo '${input.repoPath}' and runtime '${input.runtimeKind}'.`,
      );
    }
    const runtimeRef = {
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
    };
    const runtime = options.requireLive
      ? await this.repoRuntimeResolver.requireRepoRuntime(runtimeRef)
      : await this.repoRuntimeResolver.ensureRepoRuntime(runtimeRef);
    return {
      ...toOpencodeRuntimeClientInput({
        runtime,
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        action,
      }),
      runtimeId: runtime.runtimeId,
    };
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
      title: `${input.role.toUpperCase()} ${input.taskId}`,
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

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "resume session", {
      requireLive: true,
    });
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
    const runtimeEndpoint = runtimeClientInput.runtimeEndpoint;
    const sessionInput = toSessionInput(input);

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeEndpoint,
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

  async attachSession(input: AttachAgentSessionInput): Promise<AgentSessionSummary> {
    const existing = this.sessions.get(input.externalSessionId);
    if (existing) {
      return existing.summary;
    }

    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "attach session", {
      requireLive: true,
    });
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
    const runtimeEndpoint = runtimeClientInput.runtimeEndpoint;
    const sessionInput = toSessionInput(input);

    const summary = registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeEndpoint,
      externalSessionId: input.externalSessionId,
      sessionInput,
      client,
      startedAt,
      startedMessage:
        input.purpose === "transcript"
          ? "Attached transcript session"
          : `Attached ${input.role} session`,
      emitStartedEvent: false,
      subscribeToEvents: false,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });

    try {
      const session = requireSession(this.sessions, input.externalSessionId);
      attachSessionToRuntimeEvents({
        sessions: this.sessions,
        runtimeEventTransports: this.runtimeEventTransports,
        createClient: this.createClient,
        runtimeEndpoint,
        externalSessionId: input.externalSessionId,
        sessionInput,
        now: this.now,
        emit: this.emit.bind(this),
        ...(this.logEvent ? { logEvent: this.logEvent } : {}),
      });
      await loadAndSeedSessionHistory(this.createClient, this.now, {
        runtimeEndpoint,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        session,
      });
    } catch (error) {
      const session = this.sessions.get(input.externalSessionId);
      if (session) {
        await detachSessionRuntime(session, this.sessions, this.runtimeEventTransports);
      }
      throw error;
    }

    return summary;
  }

  async detachSession(externalSessionId: string): Promise<void> {
    const session = this.sessions.get(externalSessionId);
    if (!session) {
      clearSessionListeners(this.listeners, externalSessionId);
      return;
    }

    await detachSessionRuntime(session, this.sessions, this.runtimeEventTransports);
    clearSessionListeners(this.listeners, externalSessionId);
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

  async listLiveAgentSessions(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSummary[]> {
    const truths = await this.listLiveSessionTruths(input);
    return truths.flatMap((truth) => {
      if (truth.type !== "live") {
        return [];
      }
      return [
        {
          externalSessionId: truth.ref.externalSessionId,
          title: truth.title,
          workingDirectory: truth.ref.workingDirectory,
          startedAt: truth.startedAt,
          status: truth.status,
        },
      ];
    });
  }

  async listLiveSessionTruths(input: ListLiveSessionTruthInput): Promise<LiveSessionTruth[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInputWithRuntimeId(
      { ...input, workingDirectory: input.repoPath },
      "list live session truths",
      { requireLive: true },
    );
    const snapshots = await listOpencodeLiveAgentSessionSnapshots({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      now: this.now,
      ...(input.directories ? { directories: input.directories } : {}),
    });
    return snapshots.map((snapshot) =>
      toLiveSessionTruthFromSnapshot({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: snapshot.workingDirectory,
          externalSessionId: snapshot.externalSessionId,
        },
        runtimeId: runtimeClientInput.runtimeId ?? null,
        snapshot,
      }),
    );
  }

  async readLiveSessionTruth(input: ReadLiveSessionTruthInput): Promise<LiveSessionTruth> {
    const runtimeClientInput = await this.resolveRuntimeClientInputWithRuntimeId(
      input,
      "read live session truth",
      { requireLive: true },
    );
    const snapshots = await listOpencodeLiveAgentSessionSnapshots({
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      directories: [input.workingDirectory],
      now: this.now,
    });
    const snapshot =
      snapshots.find((candidate) => candidate.externalSessionId === input.externalSessionId) ??
      null;
    return toLiveSessionTruthFromSnapshot({
      ref: snapshot
        ? {
            ...input,
            workingDirectory: snapshot.workingDirectory,
          }
        : input,
      runtimeId: runtimeClientInput.runtimeId ?? null,
      snapshot,
    });
  }

  hasSession(externalSessionId: string): boolean {
    return hasSession(this.sessions, externalSessionId);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(input, "load session history", {
      requireLive: true,
    });
    const preservedDisplayPartsByMessageId = new Map(
      [...this.sessions.values()]
        .filter(
          (session) =>
            session.externalSessionId === input.externalSessionId &&
            session.eventTransportKey === runtimeClientInput.runtimeEndpoint,
        )
        .flatMap((session) =>
          [...session.messageMetadataById.entries()].flatMap(([messageId, metadata]) =>
            metadata.displayParts ? [[messageId, metadata.displayParts] as const] : [],
          ),
        ),
    );

    const matchingSessions = [...this.sessions.values()].filter(
      (session) =>
        session.externalSessionId === input.externalSessionId &&
        session.eventTransportKey === runtimeClientInput.runtimeEndpoint,
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

    for (const session of otherSessions) {
      for (const [partId, correlationKey] of primarySession.subagentCorrelationKeyByPartId) {
        session.subagentCorrelationKeyByPartId.set(partId, correlationKey);
      }
      for (const [
        externalSessionId,
        correlationKey,
      ] of primarySession.subagentCorrelationKeyByExternalSessionId) {
        session.subagentCorrelationKeyByExternalSessionId.set(externalSessionId, correlationKey);
      }
      session.pendingSubagentCorrelationKeys.splice(
        0,
        session.pendingSubagentCorrelationKeys.length,
        ...primarySession.pendingSubagentCorrelationKeys,
      );
      session.pendingSubagentCorrelationKeysBySignature.clear();
      for (const [signature, pending] of primarySession.pendingSubagentCorrelationKeysBySignature) {
        session.pendingSubagentCorrelationKeysBySignature.set(signature, [...pending]);
      }
    }

    return history;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    return loadSessionTodos(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "load session todos", { requireLive: true })),
      externalSessionId: input.externalSessionId,
    });
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    return listAvailableModels(
      this.createClient,
      await this.resolveRuntimeClientInput(
        { ...input, workingDirectory: input.repoPath },
        "list available models",
        { requireLive: true },
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
        { requireLive: true },
      ),
    );
  }

  async searchFiles(
    input: import("@openducktor/core").SearchAgentFilesInput,
  ): Promise<import("@openducktor/core").AgentFileSearchResult[]> {
    return searchFiles(this.createClient, {
      ...(await this.resolveRuntimeClientInput(input, "search files", { requireLive: true })),
      query: input.query,
    });
  }

  async listAvailableToolIds(input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  }): Promise<string[]> {
    return listAvailableToolIds(this.createClient, input);
  }

  async getMcpStatus(input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  }): Promise<Record<string, McpServerStatus>> {
    return getMcpStatus(this.createClient, input);
  }

  async connectMcpServer(input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    name: string;
  }): Promise<void> {
    await connectMcpServer(this.createClient, input);
    clearWorkflowToolCacheForDirectory(this.sessions, input.workingDirectory);
  }

  shouldRestartRuntimeForMcpStatusError(message: string): boolean {
    return /configinvaliderror|opencode_config_content|loglevel|invalid option/i.test(message);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    const tools = await this.resolveSessionToolSelection(session);
    this.emit(input.externalSessionId, {
      type: "session_status",
      externalSessionId: input.externalSessionId,
      timestamp: this.now(),
      status: { type: "busy" },
    });
    try {
      await sendUserMessage({
        session,
        request: input,
        tools,
      });
    } catch (error) {
      setSessionIdle(session);
      this.emit(input.externalSessionId, {
        type: "session_idle",
        externalSessionId: input.externalSessionId,
        timestamp: this.now(),
      });
      throw error;
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
    const session = requireSession(this.sessions, input.externalSessionId);
    await replyApproval(session, input);
    this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    await replyQuestion(session, input);
    this.clearPendingSubagentInputEvent(input.externalSessionId, input.requestId);
  }

  subscribeEvents(
    externalSessionId: string,
    listener: (event: AgentEvent) => void,
  ): EventUnsubscribe {
    return subscribeSessionEvents(this.listeners, externalSessionId, listener);
  }

  async stopSession(externalSessionId: string): Promise<void> {
    const session = requireSession(this.sessions, externalSessionId);
    await stopSessionRuntime(session, this.sessions, this.runtimeEventTransports);

    this.emit(externalSessionId, {
      type: "session_finished",
      externalSessionId,
      timestamp: this.now(),
      message: "Session stopped",
    });
    clearSessionListeners(this.listeners, externalSessionId);
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    return loadSessionDiffOp(
      (await this.resolveRuntimeClientInput(input, "load session diff", { requireLive: true }))
        .runtimeEndpoint,
      input.externalSessionId,
      input.runtimeHistoryAnchor,
    );
  }

  async loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return loadFileStatusOp(
      (await this.resolveRuntimeClientInput(input, "load file status", { requireLive: true }))
        .runtimeEndpoint,
    );
  }

  private emit(externalSessionId: string, event: AgentEvent): void {
    emitSessionEvent(this.listeners, externalSessionId, event);
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
