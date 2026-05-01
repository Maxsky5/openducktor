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
  ListLiveAgentSessionPendingInput,
  ListLiveAgentSessionsInput,
  LiveAgentSessionPendingInputByExternalSessionId,
  LiveAgentSessionSnapshot,
  LiveAgentSessionSummary,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyPermissionInput,
  ReplyQuestionInput,
  ReplyRuntimeSessionPermissionInput,
  ReplyRuntimeSessionQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
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
import { sendUserMessage } from "./message-execution";
import {
  listLiveAgentSessionPendingInput,
  loadAndSeedSessionHistory,
  loadSessionHistory,
  loadSessionTodos,
  replyPermission,
  replyPermissionToTarget,
  replyQuestion,
  replyQuestionToTarget,
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
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

const toLiveAgentSessionStatus = (status: unknown): LiveAgentSessionSummary["status"] => {
  if (status === undefined || status === null) {
    return {
      type: "idle",
    };
  }
  if (typeof status !== "object" || !("type" in status)) {
    throw new Error("Malformed live agent session status payload from Opencode.");
  }

  const type = (status as { type?: unknown }).type;
  if (type === "busy" || type === "idle") {
    return {
      type,
    };
  }

  if (type === "retry") {
    const retryStatus = status as {
      attempt?: unknown;
      message?: unknown;
      next?: unknown;
      nextEpochMs?: unknown;
    };
    const attempt = retryStatus.attempt;
    const message = retryStatus.message;
    const nextEpochMs =
      typeof retryStatus.nextEpochMs === "number" ? retryStatus.nextEpochMs : retryStatus.next;
    if (typeof attempt !== "number") {
      throw new Error("Malformed Opencode retry status: missing numeric attempt.");
    }
    if (typeof message !== "string") {
      throw new Error("Malformed Opencode retry status: missing message.");
    }
    if (typeof nextEpochMs !== "number") {
      throw new Error("Malformed Opencode retry status: missing next epoch.");
    }
    return {
      type: "retry",
      attempt,
      message,
      nextEpochMs,
    };
  }

  throw new Error(`Unsupported Opencode live agent session status type: ${String(type)}`);
};

const toLiveAgentSessionStatusMap = (
  payload: unknown,
  directory: string,
): Record<string, unknown> => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(
      `Malformed Opencode session status response for directory '${directory}': expected an object map.`,
    );
  }
  return payload as Record<string, unknown>;
};

const normalizeSessionDirectory = (directory: unknown): string | undefined => {
  if (typeof directory !== "string") {
    return undefined;
  }
  const normalized = directory.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const requireSessionDirectory = (directory: unknown, sessionId: string): string => {
  const normalized = normalizeSessionDirectory(directory);
  if (normalized !== undefined) {
    return normalized;
  }
  throw new Error(`Malformed Opencode session payload for '${sessionId}': missing directory.`);
};

const requireWorkflowRole = (session: SessionRecord): AgentRole => {
  if (session.input.role !== null) {
    return session.input.role;
  }
  throw new Error(
    `Session ${session.summary.externalSessionId} is a transcript and cannot send messages.`,
  );
};

const mergeLiveAgentSessionPendingInput = (
  entries: LiveAgentSessionPendingInputByExternalSessionId[],
): LiveAgentSessionPendingInputByExternalSessionId => {
  const merged: LiveAgentSessionPendingInputByExternalSessionId = {};

  for (const entry of entries) {
    for (const [sessionId, pendingInput] of Object.entries(entry)) {
      const current = merged[sessionId] ?? { permissions: [], questions: [] };
      merged[sessionId] = {
        permissions: [...current.permissions, ...pendingInput.permissions],
        questions: [...current.questions, ...pendingInput.questions],
      };
    }
  }

  return merged;
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
      startedMessage: `Started ${input.role} session (${input.scenario})`,
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
      startedMessage: `Resumed ${input.role} session (${input.scenario})`,
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
          : `Attached ${input.role} session (${input.scenario})`,
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
      startedMessage: `Forked ${input.role} session (${input.scenario})`,
      now: this.now,
      emit: this.emit.bind(this),
      ...(this.logEvent ? { logEvent: this.logEvent } : {}),
    });
  }

  async listLiveAgentSessions(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSummary[]> {
    const snapshots = await this.listLiveAgentSessionSnapshots(input);
    return snapshots.map(
      ({ pendingPermissions: _pendingPermissions, pendingQuestions: _pendingQuestions, ...rest }) =>
        rest,
    );
  }

  async listLiveAgentSessionSnapshots(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSnapshot[]> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      { ...input, workingDirectory: input.repoPath },
      "list live agent sessions",
      { requireLive: true },
    );
    const unscopedClient = this.createClient({
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
    });
    const sessionsPayload = await unscopedClient.session.list();
    const sessions = unwrapData(sessionsPayload, "list sessions");
    const requestedDirectorySet =
      input.directories && input.directories.length > 0
        ? new Set(
            input.directories
              .map((directory) => normalizeSessionDirectory(directory))
              .filter((directory): directory is string => directory !== undefined),
          )
        : null;
    const filteredSessions =
      requestedDirectorySet === null
        ? sessions
        : sessions.filter((session) => {
            const directory = normalizeSessionDirectory(session.directory);
            return directory !== undefined && requestedDirectorySet.has(directory);
          });
    const sessionDirectories = Array.from(
      new Set(
        filteredSessions.map((session) => requireSessionDirectory(session.directory, session.id)),
      ),
    );
    const statusEntries = await Promise.all(
      sessionDirectories.map(async (directory) => {
        const statusPayload = await unscopedClient.session.status({ directory });
        return [
          directory,
          toLiveAgentSessionStatusMap(unwrapData(statusPayload, "get session status"), directory),
        ] as const;
      }),
    );
    const statusesByDirectory = new Map(statusEntries);
    const pendingInputEntries = await Promise.all(
      sessionDirectories.map((directory) =>
        listLiveAgentSessionPendingInput(this.createClient, {
          runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
          workingDirectory: directory,
        }),
      ),
    );
    const pendingInputBySession = mergeLiveAgentSessionPendingInput(pendingInputEntries);

    return filteredSessions.map((session) => {
      const normalizedDirectory = requireSessionDirectory(session.directory, session.id);
      const directoryStatuses = statusesByDirectory.get(normalizedDirectory);
      return {
        externalSessionId: session.id,
        title: session.title,
        workingDirectory: normalizedDirectory,
        startedAt: toIsoFromEpoch(session.time?.created, this.now),
        status: toLiveAgentSessionStatus(directoryStatuses?.[session.id]),
        pendingPermissions: pendingInputBySession[session.id]?.permissions ?? [],
        pendingQuestions: pendingInputBySession[session.id]?.questions ?? [],
      };
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

  async listLiveAgentSessionPendingInput(
    input: ListLiveAgentSessionPendingInput,
  ): Promise<LiveAgentSessionPendingInputByExternalSessionId> {
    return listLiveAgentSessionPendingInput(
      this.createClient,
      await this.resolveRuntimeClientInput(input, "list live agent session pending input", {
        requireLive: true,
      }),
    );
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

  async replyPermission(input: ReplyPermissionInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    await replyPermission(session, input);
  }

  async replyRuntimeSessionPermission(input: ReplyRuntimeSessionPermissionInput): Promise<void> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      input,
      "reply runtime session permission",
      { requireLive: true },
    );
    await replyPermissionToTarget(
      {
        client: this.createClient(runtimeClientInput),
        workingDirectory: runtimeClientInput.workingDirectory,
      },
      {
        requestId: input.requestId,
        reply: input.reply,
        ...(input.message ? { message: input.message } : {}),
      },
    );
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const session = requireSession(this.sessions, input.externalSessionId);
    await replyQuestion(session, input);
  }

  async replyRuntimeSessionQuestion(input: ReplyRuntimeSessionQuestionInput): Promise<void> {
    const runtimeClientInput = await this.resolveRuntimeClientInput(
      input,
      "reply runtime session question",
      { requireLive: true },
    );
    await replyQuestionToTarget(
      {
        client: this.createClient(runtimeClientInput),
        workingDirectory: runtimeClientInput.workingDirectory,
      },
      {
        requestId: input.requestId,
        answers: input.answers,
      },
    );
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

  private async resolveSessionToolSelection(
    session: SessionRecord,
  ): Promise<Record<string, boolean>> {
    const nowMs = Date.now();
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
    });

    session.workflowToolSelectionCache = selection;
    session.workflowToolSelectionCachedAt = nowMs;
    return selection;
  }
}
