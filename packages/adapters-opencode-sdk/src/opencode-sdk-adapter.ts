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
  type LoadAgentFileStatusInput,
  type LoadAgentSessionDiffInput,
  type LoadAgentSessionHistoryInput,
  type LoadAgentSessionTodosInput,
  type ReplyPermissionInput,
  type ReplyQuestionInput,
  type ResumeAgentSessionInput,
  type SendAgentUserMessageInput,
  type StartAgentSessionInput,
  type UpdateAgentSessionModelInput,
  toRuntimeClientInput,
} from "@openducktor/core";
import {
  connectMcpServer,
  getMcpStatus,
  listAvailableModels,
  listAvailableToolIds,
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
import {
  loadSessionHistory,
  loadSessionTodos,
  replyPermission,
  replyQuestion,
  sendUserMessage,
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
  SessionRecord,
} from "./types";
import { WORKFLOW_TOOL_CACHE_TTL_MS } from "./types";
import { buildRoleScopedPermissionRules } from "./workflow-tool-permissions";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

export class OpencodeSdkAdapter
  implements AgentCatalogPort, AgentSessionPort, AgentWorkspaceInspectionPort
{
  private readonly sessions = new Map<string, SessionRecord>();
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
    const client = this.createClient(
      toRuntimeClientInput(input.runtimeConnection, "start session"),
    );
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

    const client = this.createClient(
      toRuntimeClientInput(input.runtimeConnection, "resume session"),
    );
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
    const client = this.createClient(toRuntimeClientInput(input.runtimeConnection, "fork session"));
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

  hasSession(sessionId: string): boolean {
    return hasSession(this.sessions, sessionId);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    return loadSessionHistory(this.createClient, this.now, {
      ...toRuntimeClientInput(input.runtimeConnection, "load session history"),
      externalSessionId: input.externalSessionId,
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    return loadSessionTodos(this.createClient, {
      ...toRuntimeClientInput(input.runtimeConnection, "load session todos"),
      externalSessionId: input.externalSessionId,
    });
  }

  async listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog> {
    return listAvailableModels(
      this.createClient,
      toRuntimeClientInput(input.runtimeConnection, "list available models"),
    );
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
    await sendUserMessage({
      session,
      request: input,
      tools,
      now: this.now,
      emit: (event) => this.emit(session.summary.sessionId, event),
    });
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
    await stopSessionRuntime(session);
    this.sessions.delete(sessionId);

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
