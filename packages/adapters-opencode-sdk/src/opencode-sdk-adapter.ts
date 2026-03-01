import type {
  AgentEnginePort,
  AgentEvent,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  AgentSessionTodoItem,
  EventUnsubscribe,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyPermissionInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
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

export class OpencodeSdkAdapter implements AgentEnginePort {
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

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const created = await client.session.create({
      directory: input.workingDirectory,
      title: `${input.role.toUpperCase()} ${input.taskId}`,
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

    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
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

  hasSession(sessionId: string): boolean {
    return hasSession(this.sessions, sessionId);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    return loadSessionHistory(this.createClient, this.now, input);
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    return loadSessionTodos(this.createClient, input);
  }

  async listAvailableModels(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<AgentModelCatalog> {
    return listAvailableModels(this.createClient, input);
  }

  async listAvailableToolIds(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<string[]> {
    return listAvailableToolIds(this.createClient, input);
  }

  async getMcpStatus(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<Record<string, McpServerStatus>> {
    return getMcpStatus(this.createClient, input);
  }

  async connectMcpServer(input: {
    baseUrl: string;
    workingDirectory: string;
    name: string;
  }): Promise<void> {
    await connectMcpServer(this.createClient, input);
    clearWorkflowToolCacheForDirectory(this.sessions, input.workingDirectory);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    const session = requireSession(this.sessions, input.sessionId);
    await sendUserMessage({
      session,
      request: input,
      now: this.now,
      emit: (event) => this.emit(session.summary.sessionId, event),
    });
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

  private emit(sessionId: string, event: AgentEvent): void {
    emitSessionEvent(this.listeners, sessionId, event);
  }
}
