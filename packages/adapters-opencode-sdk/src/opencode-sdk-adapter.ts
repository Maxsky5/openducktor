import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeDescriptor } from "@openducktor/contracts";
import {
  type AgentCatalogPort,
  type AgentEvent,
  type AgentModelCatalog,
  type AgentSessionHistoryMessage,
  type AgentSessionPort,
  type AgentSessionSummary,
  type AgentSessionTodoItem,
  type AgentWorkspaceInspectionPort,
  type EventUnsubscribe,
  type ForkAgentSessionInput,
  type ListAgentModelsInput,
  type ListLiveAgentSessionPendingInput,
  type ListLiveAgentSessionsInput,
  type LiveAgentSessionPendingInputBySession,
  type LiveAgentSessionSnapshot,
  type LiveAgentSessionSummary,
  type LoadAgentFileStatusInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type ReplyPermissionInput,
  type ReplyQuestionInput,
  type ResumeAgentSessionInput,
  type SendAgentUserMessageInput,
  type StartAgentSessionInput,
  toRuntimeClientInput,
  type UpdateAgentSessionModelInput,
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
  loadSessionHistory,
  loadSessionTodos,
  replyPermission,
  replyQuestion,
} from "./message-ops";
import {
  clearWorkflowToolCacheForDirectory,
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

const mergeLiveAgentSessionPendingInput = (
  entries: LiveAgentSessionPendingInputBySession[],
): LiveAgentSessionPendingInputBySession => {
  const merged: LiveAgentSessionPendingInputBySession = {};

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
  private readonly logEvent: OpencodeEventLogger | undefined;

  constructor(options: OpencodeSdkAdapterOptions = {}) {
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.logEvent = options.logEvent;
  }

  getRuntimeDefinition(): RuntimeDescriptor {
    return OPENCODE_RUNTIME_DESCRIPTOR;
  }

  listRuntimeDefinitions(): RuntimeDescriptor[] {
    return [this.getRuntimeDefinition()];
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const runtimeDefinition = this.getRuntimeDefinition();
    const runtimeClientInput = toRuntimeClientInput(input.runtimeConnection, "start session");
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
    const sessionId = input.sessionId?.trim() ? input.sessionId : externalSessionId;
    const sessionInput = toSessionInput({
      ...input,
      sessionId,
    });

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      sessionId,
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
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      return existing.summary;
    }

    const runtimeClientInput = toRuntimeClientInput(input.runtimeConnection, "resume session");
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
    const sessionInput = toSessionInput({
      ...input,
      sessionId: input.sessionId,
    });

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      sessionId: input.sessionId,
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

  async forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary> {
    const runtimeClientInput = toRuntimeClientInput(input.runtimeConnection, "fork session");
    const client = this.createClient(runtimeClientInput);
    const forked = await client.session.fork({
      directory: input.workingDirectory,
      sessionID: input.parentExternalSessionId,
      ...(input.messageId ? { messageID: input.messageId } : {}),
    });
    const forkedData = unwrapData(forked, "fork session");
    const externalSessionId = forkedData.id;
    const sessionId = input.sessionId?.trim() ? input.sessionId : externalSessionId;
    const sessionInput = toSessionInput({
      ...input,
      sessionId,
    });

    return registerSession({
      sessions: this.sessions,
      runtimeEventTransports: this.runtimeEventTransports,
      createClient: this.createClient,
      runtimeEndpoint: runtimeClientInput.runtimeEndpoint,
      sessionId,
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
    const runtimeClientInput = toRuntimeClientInput(
      input.runtimeConnection,
      "list live agent sessions",
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

  hasSession(sessionId: string): boolean {
    return hasSession(this.sessions, sessionId);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const preservedDisplayPartsByMessageId = new Map(
      [...this.sessions.values()]
        .filter(
          (session) =>
            session.externalSessionId === input.externalSessionId &&
            session.input.workingDirectory === input.runtimeConnection.workingDirectory,
        )
        .flatMap((session) =>
          [...session.messageMetadataById.entries()].flatMap(([messageId, metadata]) =>
            metadata.displayParts ? [[messageId, metadata.displayParts] as const] : [],
          ),
        ),
    );

    return loadSessionHistory(this.createClient, this.now, {
      ...toRuntimeClientInput(input.runtimeConnection, "load session history"),
      externalSessionId: input.externalSessionId,
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(preservedDisplayPartsByMessageId.size > 0 ? { preservedDisplayPartsByMessageId } : {}),
    });
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    return loadSessionTodos(this.createClient, {
      ...toRuntimeClientInput(input.runtimeConnection, "load session todos"),
      externalSessionId: input.externalSessionId,
    });
  }

  async listLiveAgentSessionPendingInput(
    input: ListLiveAgentSessionPendingInput,
  ): Promise<LiveAgentSessionPendingInputBySession> {
    return listLiveAgentSessionPendingInput(
      this.createClient,
      toRuntimeClientInput(input.runtimeConnection, "list live agent session pending input"),
    );
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    return listAvailableModels(
      this.createClient,
      toRuntimeClientInput(input.runtimeConnection, "list available models"),
    );
  }

  async listAvailableSlashCommands(
    input: import("@openducktor/core").ListAgentSlashCommandsInput,
  ): Promise<import("@openducktor/core").AgentSlashCommandCatalog> {
    return listAvailableSlashCommands(
      this.createClient,
      toRuntimeClientInput(input.runtimeConnection, "list available slash commands"),
    );
  }

  async searchFiles(
    input: import("@openducktor/core").SearchAgentFilesInput,
  ): Promise<import("@openducktor/core").AgentFileSearchResult[]> {
    return searchFiles(this.createClient, {
      ...toRuntimeClientInput(input.runtimeConnection, "search files"),
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
    const session = requireSession(this.sessions, input.sessionId);
    const tools = await this.resolveSessionToolSelection(session, input.model);
    this.emit(input.sessionId, {
      type: "session_status",
      sessionId: input.sessionId,
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
      this.emit(input.sessionId, {
        type: "session_idle",
        sessionId: input.sessionId,
        timestamp: this.now(),
      });
      throw error;
    }
  }

  updateSessionModel(input: UpdateAgentSessionModelInput): void {
    const session = requireSession(this.sessions, input.sessionId);
    session.input = {
      ...session.input,
      ...(input.model ? { model: input.model } : {}),
    };
    if (!input.model) {
      delete session.input.model;
    }
    delete session.workflowToolSelectionCache;
    delete session.workflowToolSelectionCachedAt;
    delete session.workflowToolSelectionCacheModelKey;
  }

  async replyPermission(input: ReplyPermissionInput): Promise<void> {
    const session = requireSession(this.sessions, input.sessionId);
    await replyPermission(session, input);
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const session = requireSession(this.sessions, input.sessionId);
    await replyQuestion(session, input);
  }

  subscribeEvents(sessionId: string, listener: (event: AgentEvent) => void): EventUnsubscribe {
    return subscribeSessionEvents(this.listeners, sessionId, listener);
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = requireSession(this.sessions, sessionId);
    await stopSessionRuntime(session, this.sessions, this.runtimeEventTransports);

    this.emit(sessionId, {
      type: "session_finished",
      sessionId,
      timestamp: this.now(),
      message: "Session stopped",
    });
    clearSessionListeners(this.listeners, sessionId);
  }

  async loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Promise<import("@openducktor/contracts").FileDiff[]> {
    return loadSessionDiffOp(
      toRuntimeClientInput(input.runtimeConnection, "load session diff").runtimeEndpoint,
      input.sessionId,
      input.messageId,
    );
  }

  async loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Promise<import("@openducktor/contracts").FileStatus[]> {
    return loadFileStatusOp(
      toRuntimeClientInput(input.runtimeConnection, "load file status").runtimeEndpoint,
    );
  }

  private emit(sessionId: string, event: AgentEvent): void {
    emitSessionEvent(this.listeners, sessionId, event);
  }

  private async resolveSessionToolSelection(
    session: SessionRecord,
    model: SendAgentUserMessageInput["model"],
  ): Promise<Record<string, boolean>> {
    const effectiveModel = model ?? session.input.model;
    const providerId = effectiveModel?.providerId?.trim() ?? "";
    const modelId = effectiveModel?.modelId?.trim() ?? "";
    const modelKey = providerId && modelId ? `${providerId}/${modelId}` : "";
    const nowMs = Date.now();
    if (
      session.workflowToolSelectionCache &&
      typeof session.workflowToolSelectionCachedAt === "number" &&
      nowMs - session.workflowToolSelectionCachedAt < WORKFLOW_TOOL_CACHE_TTL_MS &&
      (session.workflowToolSelectionCacheModelKey ?? "") === modelKey
    ) {
      return session.workflowToolSelectionCache;
    }

    const selection = await resolveWorkflowToolSelection({
      client: session.client,
      role: session.input.role,
      runtimeDescriptor: this.getRuntimeDefinition(),
      workingDirectory: session.input.workingDirectory,
      ...(providerId && modelId ? { model: { providerId, modelId } } : {}),
    });

    session.workflowToolSelectionCache = selection;
    session.workflowToolSelectionCachedAt = nowMs;
    session.workflowToolSelectionCacheModelKey = modelKey;
    return selection;
  }
}
