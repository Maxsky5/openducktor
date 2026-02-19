import {
  type AgentEnginePort,
  type AgentEvent,
  type AgentModelCatalog,
  type AgentModelSelection,
  type AgentRole,
  type AgentSessionHistoryMessage,
  type AgentSessionSummary,
  type AgentStreamPart,
  type EventUnsubscribe,
  type LoadAgentSessionHistoryInput,
  type ReplyPermissionInput,
  type ReplyQuestionInput,
  type ResumeAgentSessionInput,
  type SendAgentUserMessageInput,
  type StartAgentSessionInput,
  buildRoleScopedOdtToolSelection,
} from "@openblueprint/core";
import {
  type Event,
  type OpencodeClient,
  type Part,
  createOpencodeClient,
} from "@opencode-ai/sdk/v2";

type SessionInput = Omit<StartAgentSessionInput, "sessionId"> & {
  sessionId: string;
};

type SessionRecord = {
  summary: AgentSessionSummary;
  input: SessionInput;
  client: OpencodeClient;
  externalSessionId: string;
  streamAbortController: AbortController;
  streamDone: Promise<void>;
  emittedAssistantMessageIds: Set<string>;
};

type ClientFactory = (input: { baseUrl: string; workingDirectory: string }) => OpencodeClient;

export type OpencodeSdkAdapterOptions = {
  now?: () => string;
  createClient?: ClientFactory;
};

export type McpServerStatus = {
  status: string;
  error?: string;
};

const nowIso = (): string => new Date().toISOString();

const buildDefaultFactory = (): ClientFactory => {
  return (input) =>
    createOpencodeClient({
      baseUrl: input.baseUrl,
      directory: input.workingDirectory,
    });
};

const readTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const readTextFromMessageInfo = (info: unknown): string => {
  if (!info || typeof info !== "object") {
    return "";
  }
  const record = info as Record<string, unknown>;
  const direct =
    record.text ??
    record.content ??
    (record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>).text
      : undefined);
  return typeof direct === "string" ? direct.trim() : "";
};

const sanitizeAssistantMessage = (rawMessage: string): string => rawMessage.trim();

const unwrapData = <T>(
  payload: { data?: T; error?: { message?: string } | unknown },
  action: string,
): NonNullable<T> => {
  if (payload.data !== undefined && payload.data !== null) {
    return payload.data as NonNullable<T>;
  }

  const errorMessage =
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof (payload.error as { message?: unknown }).message === "string"
      ? (payload.error as { message: string }).message
      : `OpenCode request failed: ${action}`;
  throw new Error(errorMessage);
};

const normalizeModelInput = (
  model: AgentModelSelection | undefined,
): {
  model?: { providerID: string; modelID: string };
  variant?: string;
  agent?: string;
} => {
  if (!model) {
    return {};
  }

  return {
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
    ...(model.variant ? { variant: model.variant } : {}),
    ...(model.opencodeAgent ? { agent: model.opencodeAgent } : {}),
  };
};

const resolveAssistantResponseMessageId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const infoId = ((payload as { info?: { id?: unknown } }).info?.id ?? null) as unknown;
  if (typeof infoId === "string" && infoId.trim().length > 0) {
    return infoId.trim();
  }

  const parts = (payload as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const messageId = (part as { messageID?: unknown }).messageID;
    if (typeof messageId === "string" && messageId.trim().length > 0) {
      return messageId.trim();
    }
  }
  return null;
};

const toToolIdList = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "invalid");
};

const resolveWorkflowToolSelection = async (input: {
  client: OpencodeClient;
  role: AgentRole;
  workingDirectory: string;
}): Promise<Record<string, boolean>> => {
  const selectionFromKnownAliases = buildRoleScopedOdtToolSelection(input.role);
  try {
    const response = await input.client.tool.ids({
      directory: input.workingDirectory,
    });
    const runtimeToolIds = toToolIdList(unwrapData(response, "list tool ids for role policy"));
    if (runtimeToolIds.length === 0) {
      return selectionFromKnownAliases;
    }
    return buildRoleScopedOdtToolSelection(input.role, {
      runtimeToolIds,
    });
  } catch {
    return selectionFromKnownAliases;
  }
};

const toDisplayText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const outputTextFromMcpPayload = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textChunks = content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const text = (entry as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : null;
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (textChunks.length === 0) {
    return undefined;
  }
  return textChunks.join("\n");
};

const readToolOutputText = (value: unknown): string | undefined => {
  return outputTextFromMcpPayload(value) ?? toDisplayText(value);
};

const isToolOutputError = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const isError = (value as { isError?: unknown }).isError;
  return isError === true;
};

const normalizeMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const normalized = value as Record<string, unknown>;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const extractPartTiming = (
  part: Part,
): {
  startedAtMs?: number;
  endedAtMs?: number;
} => {
  const direct = (part as { time?: { start?: unknown; end?: unknown } }).time;
  const fromDirectStart = typeof direct?.start === "number" ? direct.start : undefined;
  const fromDirectEnd = typeof direct?.end === "number" ? direct.end : undefined;

  const stateTime = (part as { state?: { time?: { start?: unknown; end?: unknown } } }).state?.time;
  const fromStateStart = typeof stateTime?.start === "number" ? stateTime.start : undefined;
  const fromStateEnd = typeof stateTime?.end === "number" ? stateTime.end : undefined;

  const startedAtMs = fromDirectStart ?? fromStateStart;
  const endedAtMs = fromDirectEnd ?? fromStateEnd;

  return {
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};

const mapPartToAgentStreamPart = (part: Part): AgentStreamPart | null => {
  switch (part.type) {
    case "text":
      return {
        kind: "text",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        ...(part.synthetic !== undefined ? { synthetic: part.synthetic } : {}),
        completed: Boolean(part.time?.end),
      };
    case "reasoning":
      return {
        kind: "reasoning",
        messageId: part.messageID,
        partId: part.id,
        text: part.text,
        completed: Boolean(part.time?.end),
      };
    case "tool": {
      const timing = extractPartTiming(part);
      const metadata = normalizeMetadata(
        (part as { state?: { metadata?: unknown } }).state?.metadata,
      );
      if (part.state.status === "pending") {
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "pending",
          input: part.state.input,
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      if (part.state.status === "running") {
        const title = toDisplayText(part.state.title);
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "running",
          input: part.state.input,
          ...(title ? { title } : {}),
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      if (part.state.status === "completed") {
        const output = readToolOutputText(part.state.output);
        const title = toDisplayText(part.state.title);
        if (isToolOutputError(part.state.output)) {
          return {
            kind: "tool",
            messageId: part.messageID,
            partId: part.id,
            callId: part.callID,
            tool: part.tool,
            status: "error",
            input: part.state.input,
            ...(output ? { error: output } : {}),
            ...(title ? { title } : {}),
            ...(metadata ? { metadata } : {}),
            ...timing,
          };
        }
        return {
          kind: "tool",
          messageId: part.messageID,
          partId: part.id,
          callId: part.callID,
          tool: part.tool,
          status: "completed",
          input: part.state.input,
          ...(output ? { output } : {}),
          ...(title ? { title } : {}),
          ...(metadata ? { metadata } : {}),
          ...timing,
        };
      }
      const error = toDisplayText(part.state.error);
      return {
        kind: "tool",
        messageId: part.messageID,
        partId: part.id,
        callId: part.callID,
        tool: part.tool,
        status: "error",
        input: part.state.input,
        ...(error ? { error } : {}),
        ...(metadata ? { metadata } : {}),
        ...timing,
      };
    }
    case "step-start":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "start",
      };
    case "step-finish":
      return {
        kind: "step",
        messageId: part.messageID,
        partId: part.id,
        phase: "finish",
        reason: part.reason,
        cost: part.cost,
      };
    case "subtask":
      return {
        kind: "subtask",
        messageId: part.messageID,
        partId: part.id,
        agent: part.agent,
        prompt: part.prompt,
        description: part.description,
      };
    default:
      return null;
  }
};

const readStringProp = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const normalizePartDeltaField = (field: string): string => {
  if (
    field === "reasoning_content" ||
    field === "reasoning_details" ||
    field === "reasoningContent" ||
    field === "reasoningDetails"
  ) {
    return "text";
  }
  return field;
};

const applyDeltaToPart = (part: Part, field: string, delta: string): Part | null => {
  const normalizedField = normalizePartDeltaField(field);
  const partRecord = part as Record<string, unknown>;
  const existing = partRecord[normalizedField];
  if (existing !== undefined && typeof existing !== "string") {
    return null;
  }

  return {
    ...partRecord,
    [normalizedField]: `${typeof existing === "string" ? existing : ""}${delta}`,
  } as Part;
};

const toIsoFromEpoch = (value: unknown, fallback: () => string): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback();
  }
  const iso = new Date(value).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? fallback() : iso;
};

const toSessionInput = (
  input: Omit<StartAgentSessionInput, "sessionId"> & { sessionId: string },
): SessionInput => {
  return {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    taskId: input.taskId,
    role: input.role,
    scenario: input.scenario,
    systemPrompt: input.systemPrompt,
    baseUrl: input.baseUrl,
    ...(input.model ? { model: input.model } : {}),
    sessionId: input.sessionId,
  };
};

const mapProviderListToCatalog = (payload: unknown): AgentModelCatalog => {
  if (!payload || typeof payload !== "object") {
    return { models: [], defaultModelsByProvider: {}, agents: [] };
  }

  const providers = Array.isArray((payload as { providers?: unknown }).providers)
    ? ((payload as { providers: Array<unknown> }).providers as Array<unknown>)
    : [];
  const defaults =
    typeof (payload as { default?: unknown }).default === "object" &&
    (payload as { default?: unknown }).default !== null
      ? ((payload as { default: Record<string, string> }).default ?? {})
      : {};

  const models = providers.flatMap((provider) => {
    if (!provider || typeof provider !== "object") {
      return [];
    }
    const providerId = (provider as { id?: unknown }).id;
    const providerName = (provider as { name?: unknown }).name;
    const rawModels = (provider as { models?: unknown }).models;
    if (
      typeof providerId !== "string" ||
      typeof providerName !== "string" ||
      !rawModels ||
      typeof rawModels !== "object"
    ) {
      return [];
    }

    return Object.entries(rawModels as Record<string, unknown>)
      .map(([modelId, rawModel]) => {
        if (!rawModel || typeof rawModel !== "object") {
          return null;
        }
        const modelName = (rawModel as { name?: unknown }).name;
        const variantsRaw = (rawModel as { variants?: unknown }).variants;
        const variants =
          variantsRaw && typeof variantsRaw === "object"
            ? Object.keys(variantsRaw as Record<string, unknown>)
            : [];

        return {
          id: `${providerId}/${modelId}`,
          providerId,
          providerName,
          modelId,
          modelName: typeof modelName === "string" ? modelName : modelId,
          variants,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  });

  return {
    models,
    defaultModelsByProvider: defaults,
    agents: [],
  };
};

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
      const parts = entry.parts
        .map(mapPartToAgentStreamPart)
        .filter((part): part is AgentStreamPart => part !== null && part.kind !== "text");
      return {
        messageId: entry.info.id,
        role: entry.info.role,
        timestamp: toIsoFromEpoch(entry.info.time.created, this.now),
        text,
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
    if (assistantMessage.length > 0) {
      this.emit(session.summary.sessionId, {
        type: "assistant_message",
        sessionId: session.summary.sessionId,
        timestamp: this.now(),
        message: assistantMessage,
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
    } catch {
      // Ignore abort failures for already-finished sessions.
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

    const streamDone = this.subscribeOpencodeEvents(
      {
        sessionId: input.sessionId,
        externalSessionId: input.externalSessionId,
        input: input.input,
      },
      input.client,
      controller,
    ).catch((error: unknown) => {
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

  private async subscribeOpencodeEvents(
    context: {
      sessionId: string;
      externalSessionId: string;
      input: SessionInput;
    },
    client: OpencodeClient,
    controller: AbortController,
  ): Promise<void> {
    const sse = await client.event.subscribe(
      { directory: context.input.workingDirectory },
      { signal: controller.signal },
    );
    const partsById = new Map<string, Part>();
    const messageRoleById = new Map<string, string>();
    const pendingDeltasByPartId = new Map<string, Array<{ field: string; delta: string }>>();

    for await (const event of sse.stream) {
      if (!this.isRelevantEvent(context.externalSessionId, event)) {
        continue;
      }

      if (event.type === "message.updated") {
        const properties = event.properties as Record<string, unknown>;
        const info = properties.info as Record<string, unknown> | undefined;
        const normalizedParts: Part[] = [];
        let messageId: string | undefined;
        let role: string | undefined;

        if (info && typeof info === "object") {
          messageId = readStringProp(info, ["id", "messageID", "messageId", "message_id"]);
          role = readStringProp(info, ["role"]);
          if (messageId && role) {
            messageRoleById.set(messageId, role);
          }
        }

        const rawParts = Array.isArray(properties.parts)
          ? (properties.parts as Array<unknown>)
          : info && Array.isArray((info as { parts?: unknown }).parts)
            ? (((info as { parts: Array<unknown> }).parts as Array<unknown>) ?? [])
            : [];
        if (messageId && rawParts.length > 0) {
          for (const rawPart of rawParts) {
            if (!rawPart || typeof rawPart !== "object") {
              continue;
            }
            const rawPartRecord = rawPart as Record<string, unknown>;
            const rawPartId = readStringProp(rawPartRecord, ["id"]);
            if (!rawPartId) {
              continue;
            }

            let nextPart = {
              ...(rawPartRecord as Part),
              ...(readStringProp(rawPartRecord, ["sessionID", "sessionId", "session_id"])
                ? {}
                : { sessionID: context.externalSessionId }),
              ...(readStringProp(rawPartRecord, ["messageID", "messageId", "message_id"])
                ? {}
                : { messageID: messageId }),
            } as Part;

            const pendingDeltas = pendingDeltasByPartId.get(rawPartId);
            if (pendingDeltas && pendingDeltas.length > 0) {
              for (const pending of pendingDeltas) {
                const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
                if (updated) {
                  nextPart = updated;
                }
              }
              pendingDeltasByPartId.delete(rawPartId);
            }

            partsById.set(rawPartId, nextPart);
            normalizedParts.push(nextPart);
            const mapped = mapPartToAgentStreamPart(nextPart);
            if (mapped) {
              const mappedRole = role ?? messageRoleById.get(mapped.messageId);
              if (mappedRole === "user" && mapped.kind === "text") {
                continue;
              }
              this.emit(context.sessionId, {
                type: "assistant_part",
                sessionId: context.sessionId,
                timestamp: this.now(),
                part: mapped,
              });
            }
          }
        }

        const completedAt =
          info && typeof info === "object"
            ? ((info as { time?: { completed?: unknown } }).time?.completed ?? null)
            : null;
        const finish =
          info && typeof info === "object" ? readStringProp(info, ["finish"]) : undefined;
        if (
          messageId &&
          role === "assistant" &&
          normalizedParts.length > 0 &&
          (typeof completedAt === "number" || finish === "stop")
        ) {
          const text = readTextFromParts(normalizedParts);
          const visible = sanitizeAssistantMessage(text);
          if (visible.length > 0) {
            const session = this.sessions.get(context.sessionId);
            const emitted = session?.emittedAssistantMessageIds;
            if (!emitted?.has(messageId)) {
              this.emit(context.sessionId, {
                type: "assistant_message",
                sessionId: context.sessionId,
                timestamp: this.now(),
                message: visible,
              });
              emitted?.add(messageId);
            }
          }
        }
      } else if (event.type === "message.part.delta") {
        const deltaEvent = event.properties as Record<string, unknown>;
        const partId = readStringProp(deltaEvent, ["partID", "partId", "part_id"]) ?? "";
        const messageId = readStringProp(deltaEvent, ["messageID", "messageId", "message_id"]);
        const field = readStringProp(deltaEvent, ["field"]) ?? "";
        const delta = typeof deltaEvent.delta === "string" ? deltaEvent.delta : "";
        const knownPart = partId ? partsById.get(partId) : undefined;

        if (knownPart && field.length > 0) {
          const updatedPart = applyDeltaToPart(knownPart, field, delta);
          if (updatedPart) {
            partsById.set(partId, updatedPart);
            const mapped = mapPartToAgentStreamPart(updatedPart);
            if (mapped) {
              const mappedRole = messageRoleById.get(mapped.messageId);
              if (mappedRole === "user" && mapped.kind === "text") {
                continue;
              }
              this.emit(context.sessionId, {
                type: "assistant_part",
                sessionId: context.sessionId,
                timestamp: this.now(),
                part: mapped,
              });
              continue;
            }
          }
        }

        if (partId && field.length > 0) {
          const pending = pendingDeltasByPartId.get(partId) ?? [];
          pending.push({ field, delta });
          pendingDeltasByPartId.set(partId, pending);
          continue;
        }

        if (delta.length > 0) {
          if (messageId) {
            const deltaRole = messageRoleById.get(messageId);
            if (deltaRole === "user") {
              continue;
            }
          }
          this.emit(context.sessionId, {
            type: "assistant_delta",
            sessionId: context.sessionId,
            timestamp: this.now(),
            delta,
          });
        }
      } else if (event.type === "message.part.updated") {
        let nextPart = event.properties.part;
        const pendingDeltas = pendingDeltasByPartId.get(nextPart.id);
        if (pendingDeltas && pendingDeltas.length > 0) {
          for (const pending of pendingDeltas) {
            const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
            if (updated) {
              nextPart = updated;
            }
          }
          pendingDeltasByPartId.delete(nextPart.id);
        }
        partsById.set(nextPart.id, nextPart);
        const mapped = mapPartToAgentStreamPart(nextPart);
        if (mapped) {
          const mappedRole = messageRoleById.get(mapped.messageId);
          if (mappedRole === "user" && mapped.kind === "text") {
            continue;
          }
          this.emit(context.sessionId, {
            type: "assistant_part",
            sessionId: context.sessionId,
            timestamp: this.now(),
            part: mapped,
          });
        }
      } else if (event.type === "message.part.removed") {
        const removedPartId = readStringProp(event.properties as Record<string, unknown>, [
          "partID",
          "partId",
          "part_id",
        ]);
        if (removedPartId) {
          partsById.delete(removedPartId);
          pendingDeltasByPartId.delete(removedPartId);
        }
      } else if (event.type === "session.status") {
        const status = event.properties.status;
        if (status.type === "busy" || status.type === "idle") {
          this.emit(context.sessionId, {
            type: "session_status",
            sessionId: context.sessionId,
            timestamp: this.now(),
            status: { type: status.type },
          });
        } else {
          this.emit(context.sessionId, {
            type: "session_status",
            sessionId: context.sessionId,
            timestamp: this.now(),
            status: {
              type: "retry",
              attempt: status.attempt,
              message: status.message,
              nextEpochMs: status.next,
            },
          });
        }
      } else if (event.type === "permission.asked") {
        this.emit(context.sessionId, {
          type: "permission_required",
          sessionId: context.sessionId,
          timestamp: this.now(),
          requestId: event.properties.id,
          permission: event.properties.permission,
          patterns: event.properties.patterns,
          metadata: event.properties.metadata,
        });
      } else if (event.type === "question.asked") {
        const questions = event.properties.questions as Array<{
          header: string;
          question: string;
          options: Array<{ label: string; description: string }>;
          multiple?: boolean;
          custom?: boolean;
        }>;
        this.emit(context.sessionId, {
          type: "question_required",
          sessionId: context.sessionId,
          timestamp: this.now(),
          requestId: event.properties.id,
          questions: questions.map((question) => ({
            header: question.header,
            question: question.question,
            options: question.options,
            ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
            ...(question.custom !== undefined ? { custom: question.custom } : {}),
          })),
        });
      } else if (event.type === "session.error") {
        const maybeMessage = event.properties.error?.data?.message;
        this.emit(context.sessionId, {
          type: "session_error",
          sessionId: context.sessionId,
          timestamp: this.now(),
          message: typeof maybeMessage === "string" ? maybeMessage : "Unknown session error",
        });
      } else if (event.type === "session.idle") {
        this.emit(context.sessionId, {
          type: "session_idle",
          sessionId: context.sessionId,
          timestamp: this.now(),
        });
      }
    }
  }

  private isRelevantEvent(externalSessionId: string, event: Event): boolean {
    const properties = event.properties as Record<string, unknown>;
    const directSessionId = readStringProp(properties, [
      "sessionID",
      "sessionId",
      "session_id",
      "session",
    ]);
    if (directSessionId) {
      return directSessionId === externalSessionId;
    }

    if ("part" in properties) {
      const part = properties.part as Record<string, unknown> | undefined;
      if (part && typeof part === "object") {
        const partSessionId = readStringProp(part, ["sessionID", "sessionId", "session_id"]);
        if (partSessionId) {
          return partSessionId === externalSessionId;
        }
      }
    }

    if ("info" in properties) {
      const info = properties.info as Record<string, unknown> | undefined;
      if (info && typeof info === "object") {
        const infoSessionId = readStringProp(info, ["sessionID", "sessionId", "session_id"]);
        if (infoSessionId) {
          return infoSessionId === externalSessionId;
        }
      }
    }

    return false;
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
