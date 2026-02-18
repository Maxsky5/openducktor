import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import { OpencodeSdkAdapter } from "./index";

type MockSession = {
  createCalls: unknown[];
  promptCalls: unknown[];
  abortCalls: unknown[];
  getCalls: unknown[];
  messagesCalls: unknown[];
  promptQueue: Array<{ info: { id: string }; parts: Part[] }>;
  messagesResponse: Array<{
    info: { id: string; role: "user" | "assistant"; time: { created: number } };
    parts: Part[];
  }>;
};

type MockPermission = {
  replyCalls: unknown[];
};

type MockQuestion = {
  replyCalls: unknown[];
};

type MockEventStream = {
  events: Event[];
};

const makeMockClient = ({
  sessionId = "session-opencode-1",
  streamEvents = [],
  promptQueue = [],
  messagesResponse = [],
}: {
  sessionId?: string;
  streamEvents?: Event[];
  promptQueue?: Array<{ info: { id: string }; parts: Part[] }>;
  messagesResponse?: Array<{
    info: { id: string; role: "user" | "assistant"; time: { created: number } };
    parts: Part[];
  }>;
}): {
  client: OpencodeClient;
  session: MockSession;
  permission: MockPermission;
  question: MockQuestion;
  stream: MockEventStream;
} => {
  const session: MockSession = {
    createCalls: [],
    promptCalls: [],
    abortCalls: [],
    getCalls: [],
    messagesCalls: [],
    promptQueue: [...promptQueue],
    messagesResponse: [...messagesResponse],
  };
  const permission: MockPermission = {
    replyCalls: [],
  };
  const question: MockQuestion = {
    replyCalls: [],
  };
  const stream: MockEventStream = {
    events: [...streamEvents],
  };

  const client = {
    session: {
      create: async (input: unknown) => {
        session.createCalls.push(input);
        return { data: { id: sessionId }, error: undefined };
      },
      prompt: async (input: unknown) => {
        session.promptCalls.push(input);
        const queued = session.promptQueue.shift();
        if (!queued) {
          return {
            data: {
              info: { id: "assistant-msg" },
              parts: [
                {
                  type: "text",
                  text: "No tool call",
                  id: "part-1",
                  sessionID: sessionId,
                  messageID: "assistant-msg",
                },
              ],
            },
            error: undefined,
          };
        }
        return { data: queued, error: undefined };
      },
      abort: async (input: unknown) => {
        session.abortCalls.push(input);
        return { data: true, error: undefined };
      },
      get: async (input: unknown) => {
        session.getCalls.push(input);
        return {
          data: {
            id: sessionId,
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          error: undefined,
        };
      },
      messages: async (input: unknown) => {
        session.messagesCalls.push(input);
        return {
          data: session.messagesResponse,
          error: undefined,
        };
      },
    },
    permission: {
      reply: async (input: unknown) => {
        permission.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    question: {
      reply: async (input: unknown) => {
        question.replyCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    event: {
      subscribe: async () => {
        async function* iterator(): AsyncGenerator<Event> {
          for (const event of stream.events) {
            yield event;
          }
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;

  return { client, session, permission, question, stream };
};

const makeToolExecutor = () => {
  const calls: Array<{ tool: string; payload: unknown[] }> = [];
  return {
    calls,
    tools: {
      setSpec: async (repoPath: string, taskId: string, markdown: string) => {
        calls.push({ tool: "set_spec", payload: [repoPath, taskId, markdown] });
        return { updatedAt: "2026-02-17T12:00:00Z" };
      },
      setPlan: async (
        repoPath: string,
        taskId: string,
        markdown: string,
        subtasks?: Array<{
          title: string;
          issueType?: "task" | "feature" | "bug";
          priority?: number;
          description?: string;
        }>,
      ) => {
        calls.push({ tool: "set_plan", payload: [repoPath, taskId, markdown, subtasks] });
        return { updatedAt: "2026-02-17T12:01:00Z" };
      },
      buildBlocked: async (repoPath: string, taskId: string, reason: string) => {
        calls.push({ tool: "build_blocked", payload: [repoPath, taskId, reason] });
        return {};
      },
      buildResumed: async (repoPath: string, taskId: string) => {
        calls.push({ tool: "build_resumed", payload: [repoPath, taskId] });
        return {};
      },
      buildCompleted: async (repoPath: string, taskId: string, summary?: string) => {
        calls.push({ tool: "build_completed", payload: [repoPath, taskId, summary] });
        return {};
      },
      qaApproved: async (repoPath: string, taskId: string, reportMarkdown: string) => {
        calls.push({ tool: "qa_approved", payload: [repoPath, taskId, reportMarkdown] });
        return {};
      },
      qaRejected: async (repoPath: string, taskId: string, reportMarkdown: string) => {
        calls.push({ tool: "qa_rejected", payload: [repoPath, taskId, reportMarkdown] });
        return {};
      },
    },
  };
};

const startDefaultSession = async (
  adapter: OpencodeSdkAdapter,
  sessionId = "session-1",
): Promise<void> => {
  await adapter.startSession({
    sessionId,
    repoPath: "/repo",
    workingDirectory: "/repo",
    taskId: "task-1",
    role: "spec",
    scenario: "spec_initial",
    systemPrompt: "system prompt",
    baseUrl: "http://127.0.0.1:12345",
  });
};

describe("OpencodeSdkAdapter", () => {
  test("startSession emits session_started and returns summary", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: unknown[] = [];
    adapter.subscribeEvents("session-1", (event) => events.push(event));

    const summary = await adapter.startSession({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "planner",
      scenario: "planner_initial",
      systemPrompt: "system",
      baseUrl: "http://127.0.0.1:12000",
    });

    expect(summary.sessionId).toBe("session-1");
    expect(summary.externalSessionId).toBe("session-opencode-1");
    expect(summary.role).toBe("planner");
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("session_started");
  });

  test("sendUserMessage executes extracted tool call and emits results", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({
      promptQueue: [
        {
          info: { id: "assistant-1" },
          parts: [
            {
              id: "part-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: `<obp_tool_call>\n{"tool":"set_spec","args":{"markdown":"# Spec"}}\n</obp_tool_call>`,
            } as Part,
          ],
        },
        {
          info: { id: "assistant-2" },
          parts: [
            {
              id: "part-2",
              sessionID: "session-opencode-1",
              messageID: "assistant-2",
              type: "text",
              text: "Applied and done.",
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter);

    const events: Array<{ type: string }> = [];
    const unsubscribe = adapter.subscribeEvents("session-1", (event) =>
      events.push(event as { type: string }),
    );

    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Draft and persist spec",
    });
    unsubscribe();

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual({
      tool: "set_spec",
      payload: ["/repo", "task-1", "# Spec"],
    });
    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    expect(mock.session.promptCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("sendUserMessage forwards selected model, variant, and agent", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter);
    await adapter.sendUserMessage({
      sessionId: "session-1",
      content: "Use the selected model",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "spec",
      },
    });

    expect(mock.session.promptCalls[0]).toMatchObject({
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
      variant: "high",
      agent: "spec",
    });
  });

  test("rejects workflow tool calls that are not allowed for the session role", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({
      promptQueue: [
        {
          info: { id: "assistant-1" },
          parts: [
            {
              id: "part-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: `<obp_tool_call>\n{"tool":"qa_approved","args":{"reportMarkdown":"# QA"}}\n</obp_tool_call>`,
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await startDefaultSession(adapter);

    await expect(
      adapter.sendUserMessage({
        sessionId: "session-1",
        content: "Try unauthorized qa tool",
      }),
    ).rejects.toThrow("not allowed for role spec");
    expect(executor.calls).toHaveLength(0);
  });

  test("replyPermission and replyQuestion route to opencode APIs", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
    });

    await startDefaultSession(adapter);

    await adapter.replyPermission({
      sessionId: "session-1",
      requestId: "perm-1",
      reply: "once",
      message: "approved",
    });
    await adapter.replyQuestion({
      sessionId: "session-1",
      requestId: "question-1",
      answers: [["yes"]],
    });

    expect(mock.permission.replyCalls).toHaveLength(1);
    expect(mock.question.replyCalls).toHaveLength(1);
  });

  test("event stream maps part updates, buffered deltas, status, and permission events", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({
      streamEvents: [
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-opencode-1",
            messageID: "assistant-1",
            partID: "part-1",
            field: "text",
            delta: "Hello",
          },
        } as Event,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: "",
              time: { start: Date.now() },
            },
          },
        } as Event,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-reasoning",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "Inspecting codebase",
              time: { start: Date.now() },
            },
          },
        } as Event,
        {
          type: "session.status",
          properties: {
            sessionID: "session-opencode-1",
            status: { type: "busy" },
          },
        } as Event,
        {
          type: "permission.asked",
          properties: {
            id: "perm-1",
            sessionID: "session-opencode-1",
            permission: "bash",
            patterns: ["*"],
            metadata: {},
            always: [],
          },
        } as Event,
      ],
    });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: Array<{ type: string; part?: { kind: string; text?: string } }> = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event as { type: string; part?: { kind: string; text?: string } });
    });

    await startDefaultSession(adapter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.some((event) => event.type === "assistant_part")).toBe(true);
    expect(events.some((event) => event.type === "session_status")).toBe(true);
    expect(events.some((event) => event.type === "permission_required")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "assistant_part" &&
          event.part?.kind === "text" &&
          event.part.text === "Hello",
      ),
    ).toBe(true);
  });

  test("reasoning delta updates reasoning part content instead of assistant text stream", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({
      streamEvents: [
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-reasoning",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
            },
          },
        } as Event,
        {
          type: "message.part.delta",
          properties: {
            sessionId: "session-opencode-1",
            messageId: "assistant-1",
            partId: "part-reasoning",
            field: "reasoning_content",
            delta: "Inspecting constraints",
          },
        } as Event,
      ],
    });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: Array<{ type: string; part?: { kind: string; text?: string } }> = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event as { type: string; part?: { kind: string; text?: string } });
    });

    await startDefaultSession(adapter);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reasoningUpdates = events.filter(
      (event) => event.type === "assistant_part" && event.part?.kind === "reasoning",
    );
    expect(reasoningUpdates).toHaveLength(2);
    expect(reasoningUpdates[1]?.part?.text).toBe("Inspecting constraints");
    expect(events.some((event) => event.type === "assistant_delta")).toBe(false);
  });

  test("startSession defaults to external session id when none provided", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({ sessionId: "session-opencode-42" });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const summary = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
      baseUrl: "http://127.0.0.1:12000",
    });

    expect(summary.sessionId).toBe("session-opencode-42");
    expect(summary.externalSessionId).toBe("session-opencode-42");
    expect(adapter.hasSession("session-opencode-42")).toBe(true);
  });

  test("resumeSession re-attaches existing OpenCode session", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({ sessionId: "session-opencode-9" });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const summary = await adapter.resumeSession({
      sessionId: "obp-session-9",
      externalSessionId: "session-opencode-9",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "planner",
      scenario: "planner_revision",
      systemPrompt: "system",
      baseUrl: "http://127.0.0.1:12000",
    });

    expect(summary.sessionId).toBe("obp-session-9");
    expect(summary.externalSessionId).toBe("session-opencode-9");
    expect(mock.session.getCalls).toHaveLength(1);
    expect(adapter.hasSession("obp-session-9")).toBe(true);
  });

  test("loadSessionHistory maps assistant parts and strips tool XML blocks", async () => {
    const executor = makeToolExecutor();
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:10:00Z") },
          },
          parts: [
            {
              id: "reason-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "Inspecting code",
              time: { start: Date.now(), end: Date.now() },
            } as Part,
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: `Draft complete\n<obp_tool_call>{"tool":"set_spec","args":{"markdown":"# Spec"}}</obp_tool_call>`,
            } as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter(executor.tools, {
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const history = await adapter.loadSessionHistory({
      baseUrl: "http://127.0.0.1:12000",
      workingDirectory: "/repo",
      externalSessionId: "session-opencode-1",
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.text).toBe("Draft complete");
    expect(history[0]?.parts).toHaveLength(1);
    expect(history[0]?.parts[0]?.kind).toBe("reasoning");
    expect(mock.session.messagesCalls).toHaveLength(1);
  });

  test("unknown session operations throw", async () => {
    const executor = makeToolExecutor();
    const adapter = new OpencodeSdkAdapter(executor.tools);

    await expect(
      adapter.sendUserMessage({
        sessionId: "missing",
        content: "hello",
      }),
    ).rejects.toThrow("Unknown session");

    await expect(adapter.stopSession("missing")).rejects.toThrow("Unknown session");
  });
});
