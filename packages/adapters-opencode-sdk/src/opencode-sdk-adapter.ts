import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  AgentEnginePort,
  AgentEvent,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentStreamPart,
  EventUnsubscribe,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyPermissionInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { buildDefaultFactory, nowIso } from "./client-factory";
import { unwrapData } from "./data-utils";
import { subscribeOpencodeEvents } from "./event-stream";
import {
  extractMessageTotalTokens,
  readTextFromMessageInfo,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";
import {
  mapProviderListToCatalog,
  normalizeModelInput,
  resolveAssistantResponseMessageId,
  toToolIdList,
} from "./payload-mappers";
import { toIsoFromEpoch, toSessionInput } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type {
  ClientFactory,
  McpServerStatus,
  OpencodeSdkAdapterOptions,
  SessionInput,
  SessionRecord,
} from "./types";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

export class OpencodeSdkAdapter implements AgentEnginePort {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Map<string, Set<(event: AgentEvent) => void>>();
  private readonly now: () => string;
  private readonly createClient: ClientFactory;

  constructor(options: OpencodeSdkAdapterOptions = {}) {
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
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

    return this.registerSession({
      sessionId,
      externalSessionId,
      input: sessionInput,
      client,
      startedAt: this.now(),
      startedMessage: `Started ${input.role} session (${input.scenario})`,
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

    return this.registerSession({
      sessionId: input.sessionId,
      externalSessionId: input.externalSessionId,
      input: sessionInput,
      client,
      startedAt,
      startedMessage: `Resumed ${input.role} session (${input.scenario})`,
    });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Promise<AgentSessionHistoryMessage[]> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.session.messages({
      sessionID: input.externalSessionId,
      directory: input.workingDirectory,
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
    const data = unwrapData(response, "load session messages");
    const mapped = data.map((entry) => {
      const rawTextFromParts = readTextFromParts(entry.parts);
      const rawText =
        rawTextFromParts.length > 0 ? rawTextFromParts : readTextFromMessageInfo(entry.info);
      const text = entry.info.role === "assistant" ? sanitizeAssistantMessage(rawText) : rawText;
      const totalTokens = extractMessageTotalTokens(entry.info, entry.parts);
      const parts = entry.parts
        .map(mapPartToAgentStreamPart)
        .filter((part): part is AgentStreamPart => part !== null && part.kind !== "text");
      return {
        messageId: entry.info.id,
        role: entry.info.role,
        timestamp: toIsoFromEpoch(entry.info.time.created, this.now),
        text,
        ...(typeof totalTokens === "number" ? { totalTokens } : {}),
        parts,
      };
    });
    mapped.sort((a, b) => {
      const aTime = Date.parse(a.timestamp);
      const bTime = Date.parse(b.timestamp);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return 0;
      }
      return aTime - bTime;
    });
    return mapped;
  }

  async loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]> {
    try {
      const baseUrl = input.baseUrl.replace(/\/+$/, "");
      const url = new URL(`${baseUrl}/session/${encodeURIComponent(input.externalSessionId)}/todo`);
      if (input.workingDirectory.trim().length > 0) {
        url.searchParams.set("directory", input.workingDirectory);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      return normalizeTodoList(payload);
    } catch {
      return [];
    }
  }

  async listAvailableModels(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<AgentModelCatalog> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.config.providers({
      directory: input.workingDirectory,
    });
    const providerData = unwrapData(response, "list configured providers");
    const agentsData = await (async () => {
      const app = (client as { app?: { agents?: unknown } }).app;
      if (!app || typeof app.agents !== "function") {
        return [];
      }
      try {
        const payload = await app.agents({
          directory: input.workingDirectory,
        } as {
          directory: string;
        });
        return unwrapData(
          payload as { data?: unknown; error?: { message?: string } | unknown },
          "list agents",
        );
      } catch {
        return [];
      }
    })();
    const baseCatalog = mapProviderListToCatalog(providerData);
    const agents = Array.isArray(agentsData)
      ? agentsData
          .map((entry) => ({
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            mode: entry.mode,
            ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
            ...(entry.native !== undefined ? { native: entry.native } : {}),
            ...(typeof entry.color === "string" ? { color: entry.color } : {}),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    return {
      ...baseCatalog,
      agents,
    };
  }

  async listAvailableToolIds(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<string[]> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.tool.ids({
      directory: input.workingDirectory,
    });
    const payload = unwrapData(response, "list tool ids");
    return toToolIdList(payload);
  }

  async getMcpStatus(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<Record<string, McpServerStatus>> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.mcp.status({
      directory: input.workingDirectory,
    });
    const payload = unwrapData(response, "get mcp status");
    if (!payload || typeof payload !== "object") {
      return {};
    }

    const statusByServer: Record<string, McpServerStatus> = {};
    for (const [name, rawStatus] of Object.entries(payload as Record<string, unknown>)) {
      if (!rawStatus || typeof rawStatus !== "object") {
        continue;
      }
      const status = (rawStatus as { status?: unknown }).status;
      if (typeof status !== "string" || status.trim().length === 0) {
        continue;
      }
      const error = (rawStatus as { error?: unknown }).error;
      statusByServer[name] =
        typeof error === "string" && error.trim().length > 0 ? { status, error } : { status };
    }
    return statusByServer;
  }

  async connectMcpServer(input: {
    baseUrl: string;
    workingDirectory: string;
    name: string;
  }): Promise<void> {
    const client = this.createClient({
      baseUrl: input.baseUrl,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.mcp.connect({
      directory: input.workingDirectory,
      name: input.name,
    });
    unwrapData(response, `connect mcp server ${input.name}`);
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    const session = this.requireSession(input.sessionId);
    const model = input.model ?? session.input.model;
    const modelInput = normalizeModelInput(model);
    const workflowToolSelection = await resolveWorkflowToolSelection({
      client: session.client,
      role: session.input.role,
      workingDirectory: session.input.workingDirectory,
    });
    const response = await session.client.session.prompt({
      sessionID: session.externalSessionId,
      directory: session.input.workingDirectory,
      ...(session.input.systemPrompt.trim().length > 0
        ? { system: session.input.systemPrompt }
        : {}),
      ...(modelInput.model ? { model: modelInput.model } : {}),
      ...(modelInput.variant ? { variant: modelInput.variant } : {}),
      ...(modelInput.agent ? { agent: modelInput.agent } : {}),
      tools: workflowToolSelection,
      parts: [{ type: "text", text: input.content }],
    });
    const responseData = unwrapData(response, "prompt session");
    const responseMessageId = resolveAssistantResponseMessageId(responseData);

    for (const responsePart of responseData.parts) {
      const mappedPart = mapPartToAgentStreamPart(responsePart);
      if (!mappedPart) {
        continue;
      }
      this.emit(session.summary.sessionId, {
        type: "assistant_part",
        sessionId: session.summary.sessionId,
        timestamp: this.now(),
        part: mappedPart,
      });
    }

    const assistantMessage = sanitizeAssistantMessage(readTextFromParts(responseData.parts));
    const totalTokens = extractMessageTotalTokens(
      (responseData as { info?: unknown }).info,
      responseData.parts,
    );
    if (assistantMessage.length > 0) {
      this.emit(session.summary.sessionId, {
        type: "assistant_message",
        sessionId: session.summary.sessionId,
        timestamp: this.now(),
        message: assistantMessage,
        ...(typeof totalTokens === "number" ? { totalTokens } : {}),
      });
      if (responseMessageId) {
        session.emittedAssistantMessageIds.add(responseMessageId);
      }
    }

    this.emit(session.summary.sessionId, {
      type: "session_idle",
      sessionId: session.summary.sessionId,
      timestamp: this.now(),
    });
  }

  async replyPermission(input: ReplyPermissionInput): Promise<void> {
    const session = this.requireSession(input.sessionId);
    await session.client.permission.reply({
      directory: session.input.workingDirectory,
      requestID: input.requestId,
      reply: input.reply,
      ...(input.message ? { message: input.message } : {}),
    });
  }

  async replyQuestion(input: ReplyQuestionInput): Promise<void> {
    const session = this.requireSession(input.sessionId);
    await session.client.question.reply({
      directory: session.input.workingDirectory,
      requestID: input.requestId,
      answers: input.answers,
    });
  }

  subscribeEvents(sessionId: string, listener: (event: AgentEvent) => void): EventUnsubscribe {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);

    return () => {
      const active = this.listeners.get(sessionId);
      if (!active) {
        return;
      }
      active.delete(listener);
      if (active.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);

    try {
      await session.client.session.abort({
        directory: session.input.workingDirectory,
        sessionID: session.externalSessionId,
      });
    } catch (abortError) {
      void abortError;
    }

    session.streamAbortController.abort();
    await session.streamDone.catch(() => undefined);
    this.sessions.delete(sessionId);

    this.emit(sessionId, {
      type: "session_finished",
      sessionId,
      timestamp: this.now(),
      message: "Session stopped",
    });
    this.listeners.delete(sessionId);
  }

  private registerSession(input: {
    sessionId: string;
    externalSessionId: string;
    input: SessionInput;
    client: OpencodeClient;
    startedAt: string;
    startedMessage: string;
  }): AgentSessionSummary {
    const controller = new AbortController();
    const summary: AgentSessionSummary = {
      sessionId: input.sessionId,
      externalSessionId: input.externalSessionId,
      role: input.input.role,
      scenario: input.input.scenario,
      startedAt: input.startedAt,
      status: "running",
    };

    const streamDone = subscribeOpencodeEvents({
      context: {
        sessionId: input.sessionId,
        externalSessionId: input.externalSessionId,
        input: input.input,
      },
      client: input.client,
      controller,
      now: this.now,
      emit: this.emit.bind(this),
      getSession: (sessionId) => this.sessions.get(sessionId),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Event stream failed";
      this.emit(input.sessionId, {
        type: "session_error",
        sessionId: input.sessionId,
        timestamp: this.now(),
        message,
      });
    });

    this.sessions.set(input.sessionId, {
      summary,
      input: input.input,
      client: input.client,
      externalSessionId: input.externalSessionId,
      streamAbortController: controller,
      streamDone,
      emittedAssistantMessageIds: new Set<string>(),
    });

    this.emit(input.sessionId, {
      type: "session_started",
      sessionId: input.sessionId,
      timestamp: this.now(),
      message: input.startedMessage,
    });

    return summary;
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private emit(sessionId: string, event: AgentEvent): void {
    const listeners = this.listeners.get(sessionId);
    if (!listeners || listeners.size === 0) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }
}
