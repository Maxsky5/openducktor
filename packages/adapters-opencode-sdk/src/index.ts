import {
  createOpencodeClient,
  type Event,
  type OpencodeClient,
  type Part,
} from "@opencode-ai/sdk/v2";
import type {
  AgentEnginePort,
  AgentEvent,
  AgentSessionSummary,
  AgentToolCall,
  AgentToolName,
  EventUnsubscribe,
  ReplyPermissionInput,
  ReplyQuestionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openblueprint/core";

type SessionToolExecutor = {
  setSpec: (repoPath: string, taskId: string, markdown: string) => Promise<{ updatedAt?: string }>;
  setPlan: (
    repoPath: string,
    taskId: string,
    markdown: string,
    subtasks?: Array<{
      title: string;
      issueType?: "task" | "feature" | "bug";
      priority?: number;
      description?: string;
    }>,
  ) => Promise<{ updatedAt?: string }>;
  buildBlocked: (repoPath: string, taskId: string, reason: string) => Promise<unknown>;
  buildResumed: (repoPath: string, taskId: string) => Promise<unknown>;
  buildCompleted: (repoPath: string, taskId: string, summary?: string) => Promise<unknown>;
  qaApproved: (repoPath: string, taskId: string, reportMarkdown: string) => Promise<unknown>;
  qaRejected: (repoPath: string, taskId: string, reportMarkdown: string) => Promise<unknown>;
};

type SessionRecord = {
  summary: AgentSessionSummary;
  input: Required<StartAgentSessionInput>;
  client: OpencodeClient;
  externalSessionId: string;
  streamAbortController: AbortController;
  streamDone: Promise<void>;
};

type ClientFactory = (input: Required<StartAgentSessionInput>) => OpencodeClient;

export type OpencodeSdkAdapterOptions = {
  now?: () => string;
  createClient?: ClientFactory;
  maxAutoToolLoops?: number;
};

const nowIso = (): string => new Date().toISOString();

const buildDefaultFactory = (): ClientFactory => {
  return (input) =>
    createOpencodeClient({
      baseUrl: input.baseUrl,
      directory: input.workingDirectory,
    });
};

const normalizeStartInput = (input: StartAgentSessionInput): Required<StartAgentSessionInput> => {
  return {
    ...input,
    sessionId: input.sessionId ?? `obp-session-${crypto.randomUUID()}`,
  };
};

const TOOL_BLOCK_PATTERN = /<obp_tool_call>\s*([\s\S]*?)\s*<\/obp_tool_call>/g;

const readTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const parseToolCall = (block: string): AgentToolCall | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const tool = (parsed as { tool?: unknown }).tool;
  const args = (parsed as { args?: unknown }).args;
  if (typeof tool !== "string" || !args || typeof args !== "object") {
    return null;
  }

  switch (tool) {
    case "set_spec": {
      const markdown = (args as { markdown?: unknown }).markdown;
      if (typeof markdown !== "string" || markdown.trim().length === 0) {
        return null;
      }
      return { tool, args: { markdown } };
    }
    case "set_plan": {
      const markdown = (args as { markdown?: unknown }).markdown;
      const subtasks = (args as { subtasks?: unknown }).subtasks;
      if (typeof markdown !== "string" || markdown.trim().length === 0) {
        return null;
      }

      if (subtasks === undefined) {
        return { tool, args: { markdown } };
      }

      if (!Array.isArray(subtasks)) {
        return null;
      }

      const normalized = subtasks
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const title = (entry as { title?: unknown }).title;
          const issueType = (entry as { issueType?: unknown }).issueType;
          const priority = (entry as { priority?: unknown }).priority;
          const description = (entry as { description?: unknown }).description;
          if (typeof title !== "string" || title.trim().length === 0) {
            return null;
          }
          if (
            issueType !== undefined &&
            issueType !== "task" &&
            issueType !== "feature" &&
            issueType !== "bug"
          ) {
            return null;
          }
          if (priority !== undefined && (typeof priority !== "number" || Number.isNaN(priority))) {
            return null;
          }
          if (description !== undefined && typeof description !== "string") {
            return null;
          }
          return {
            title,
            ...(issueType ? { issueType } : {}),
            ...(typeof priority === "number" ? { priority } : {}),
            ...(description ? { description } : {}),
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            title: string;
            issueType?: "task" | "feature" | "bug";
            priority?: number;
            description?: string;
          } => entry !== null,
        );

      return { tool, args: { markdown, subtasks: normalized } };
    }
    case "build_blocked": {
      const reason = (args as { reason?: unknown }).reason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return null;
      }
      return { tool, args: { reason } };
    }
    case "build_resumed":
      return { tool, args: {} };
    case "build_completed": {
      const summary = (args as { summary?: unknown }).summary;
      if (summary !== undefined && typeof summary !== "string") {
        return null;
      }
      return { tool, args: summary ? { summary } : {} };
    }
    case "qa_approved": {
      const reportMarkdown = (args as { reportMarkdown?: unknown }).reportMarkdown;
      if (typeof reportMarkdown !== "string" || reportMarkdown.trim().length === 0) {
        return null;
      }
      return { tool, args: { reportMarkdown } };
    }
    case "qa_rejected": {
      const reportMarkdown = (args as { reportMarkdown?: unknown }).reportMarkdown;
      if (typeof reportMarkdown !== "string" || reportMarkdown.trim().length === 0) {
        return null;
      }
      return { tool, args: { reportMarkdown } };
    }
    default:
      return null;
  }
};

const extractToolCalls = (message: string): AgentToolCall[] => {
  const calls: AgentToolCall[] = [];
  const matcher = message.matchAll(TOOL_BLOCK_PATTERN);
  for (const match of matcher) {
    const jsonPayload = match[1];
    if (!jsonPayload) {
      continue;
    }
    const call = parseToolCall(jsonPayload.trim());
    if (call) {
      calls.push(call);
    }
  }
  return calls;
};

const normalizeToolResult = (tool: AgentToolName, result: unknown): string => {
  if (!result || typeof result !== "object") {
    return `${tool} completed`;
  }
  const updatedAt = (result as { updatedAt?: unknown }).updatedAt;
  if (typeof updatedAt === "string" && updatedAt.length > 0) {
    return `${tool} completed at ${updatedAt}`;
  }
  return `${tool} completed`;
};

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

export class OpencodeSdkAdapter implements AgentEnginePort {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Map<string, Set<(event: AgentEvent) => void>>();
  private readonly now: () => string;
  private readonly createClient: ClientFactory;
  private readonly maxAutoToolLoops: number;

  constructor(
    private readonly tools: SessionToolExecutor,
    options: OpencodeSdkAdapterOptions = {},
  ) {
    this.now = options.now ?? nowIso;
    this.createClient = options.createClient ?? buildDefaultFactory();
    this.maxAutoToolLoops = options.maxAutoToolLoops ?? 3;
  }

  async startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary> {
    const normalized = normalizeStartInput(input);
    const client = this.createClient(normalized);
    const created = await client.session.create({
      directory: normalized.workingDirectory,
      title: `${normalized.role.toUpperCase()} ${normalized.taskId}`,
    });
    const createdData = unwrapData(created, "create session");

    const externalSessionId = createdData.id;
    const sessionId = normalized.sessionId;
    const controller = new AbortController();

    const summary: AgentSessionSummary = {
      sessionId,
      externalSessionId,
      role: normalized.role,
      scenario: normalized.scenario,
      startedAt: this.now(),
      status: "running",
    };

    const streamDone = this.subscribeOpencodeEvents(
      {
        sessionId,
        externalSessionId,
        input: normalized,
      },
      client,
      controller,
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Event stream failed";
      this.emit(sessionId, {
        type: "session_error",
        sessionId,
        timestamp: this.now(),
        message,
      });
    });

    this.sessions.set(sessionId, {
      summary,
      input: normalized,
      client,
      externalSessionId,
      streamAbortController: controller,
      streamDone,
    });

    this.emit(sessionId, {
      type: "session_started",
      sessionId,
      timestamp: this.now(),
      message: `Started ${normalized.role} session (${normalized.scenario})`,
    });

    return summary;
  }

  async sendUserMessage(input: SendAgentUserMessageInput): Promise<void> {
    const session = this.requireSession(input.sessionId);
    await this.executePromptLoop(session, input.content, 0);
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

  subscribeEvents(
    sessionId: string,
    listener: (event: AgentEvent) => void,
  ): EventUnsubscribe {
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

  private async executePromptLoop(
    session: SessionRecord,
    userMessage: string,
    depth: number,
  ): Promise<void> {
    const response = await session.client.session.prompt({
      sessionID: session.externalSessionId,
      directory: session.input.workingDirectory,
      system: session.input.systemPrompt,
      parts: [{ type: "text", text: userMessage }],
    });
    const responseData = unwrapData(response, "prompt session");

    const assistantMessage = readTextFromParts(responseData.parts);
    if (assistantMessage) {
      this.emit(session.summary.sessionId, {
        type: "assistant_message",
        sessionId: session.summary.sessionId,
        timestamp: this.now(),
        message: assistantMessage,
      });
    }

    const toolCalls = extractToolCalls(assistantMessage);
    if (toolCalls.length === 0 || depth >= this.maxAutoToolLoops) {
      return;
    }

    const toolResultMessages: string[] = [];
    for (const toolCall of toolCalls) {
      this.emit(session.summary.sessionId, {
        type: "tool_call",
        sessionId: session.summary.sessionId,
        timestamp: this.now(),
        call: toolCall,
      });

      try {
        const result = await this.executeToolCall(session, toolCall);
        const resultMessage = normalizeToolResult(toolCall.tool, result);
        this.emit(session.summary.sessionId, {
          type: "tool_result",
          sessionId: session.summary.sessionId,
          timestamp: this.now(),
          tool: toolCall.tool,
          success: true,
          message: resultMessage,
        });
        toolResultMessages.push(`${toolCall.tool}: success (${resultMessage})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool execution failed";
        this.emit(session.summary.sessionId, {
          type: "tool_result",
          sessionId: session.summary.sessionId,
          timestamp: this.now(),
          tool: toolCall.tool,
          success: false,
          message,
        });
        throw error;
      }
    }

    await this.executePromptLoop(
      session,
      `OpenBlueprint tool results:\n${toolResultMessages.join("\n")}\nContinue the task.`,
      depth + 1,
    );
  }

  private async executeToolCall(session: SessionRecord, toolCall: AgentToolCall): Promise<unknown> {
    const { repoPath, taskId } = session.input;
    switch (toolCall.tool) {
      case "set_spec":
        return this.tools.setSpec(repoPath, taskId, toolCall.args.markdown);
      case "set_plan":
        return this.tools.setPlan(
          repoPath,
          taskId,
          toolCall.args.markdown,
          toolCall.args.subtasks,
        );
      case "build_blocked":
        return this.tools.buildBlocked(repoPath, taskId, toolCall.args.reason);
      case "build_resumed":
        return this.tools.buildResumed(repoPath, taskId);
      case "build_completed":
        return this.tools.buildCompleted(repoPath, taskId, toolCall.args.summary);
      case "qa_approved":
        return this.tools.qaApproved(repoPath, taskId, toolCall.args.reportMarkdown);
      case "qa_rejected":
        return this.tools.qaRejected(repoPath, taskId, toolCall.args.reportMarkdown);
      default:
        return null;
    }
  }

  private async subscribeOpencodeEvents(
    context: {
      sessionId: string;
      externalSessionId: string;
      input: Required<StartAgentSessionInput>;
    },
    client: OpencodeClient,
    controller: AbortController,
  ): Promise<void> {
    const sse = await client.event.subscribe(
      { directory: context.input.workingDirectory },
      { signal: controller.signal },
    );

    for await (const event of sse.stream) {
      if (!this.isRelevantEvent(context.externalSessionId, event)) {
        continue;
      }

      if (event.type === "message.part.delta") {
        this.emit(context.sessionId, {
          type: "assistant_delta",
          sessionId: context.sessionId,
          timestamp: this.now(),
          delta: event.properties.delta,
        });
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
    if ("sessionID" in event.properties && event.properties.sessionID) {
      return event.properties.sessionID === externalSessionId;
    }
    if ("session" in event.properties && typeof event.properties.session === "string") {
      return event.properties.session === externalSessionId;
    }
    if ("info" in event.properties) {
      const info = event.properties.info as { sessionID?: unknown; id?: unknown };
      return (
        typeof info.sessionID === "string" &&
        info.sessionID === externalSessionId
      );
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
