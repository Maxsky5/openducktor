import { describe, expect, test } from "bun:test";
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2";
import type { AgentEvent } from "@openducktor/core";
import {
  makeMockClient,
  OpencodeSdkAdapter,
  sessionRef,
  sessionRuntimeRef,
  startDefaultSession,
} from "./test-support";
import type { SessionRecord } from "./types";

describe("OpencodeSdkAdapter session lifecycle", () => {
  const localSessions = (adapter: OpencodeSdkAdapter): Map<string, SessionRecord> =>
    (adapter as unknown as { sessions: Map<string, SessionRecord> }).sessions;

  test("subscribeEvents prepares existing session state without emitting a started event", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:01Z") },
            finish: "stop",
          },
          parts: [
            {
              id: "tool-part-1",
              type: "tool",
              messageID: "assistant-1",
              sessionID: "session-opencode-1",
              callID: "call-1",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "pwd" },
                output: "output",
              },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) =>
      events.push(event),
    );

    expect(mock.session.getCalls).toHaveLength(1);
    expect(mock.session.messagesCalls).toHaveLength(1);
    expect(events).toEqual([]);
  });

  test("subscribeEvents rolls back partial registration when runtime event subscription fails", async () => {
    const mock = makeMockClient({});
    const unsupportedClient = {
      ...mock.client,
      global: {},
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => unsupportedClient,
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.subscribeEvents(sessionRef("session-opencode-1"), () => {}),
    ).rejects.toThrow("client.global.event()");
    expect(localSessions(adapter).has("session-opencode-1")).toBe(false);
  });

  test("prepared existing session state does not keep session-bound running subagents in pending correlation queues", async () => {
    const mock = makeMockClient({
      messagesResponse: [
        {
          info: {
            id: "msg-200",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:00Z") },
          },
          parts: [
            {
              id: "subtask-a",
              sessionID: "session-opencode-1",
              messageID: "msg-200",
              type: "subtask",
              agent: "build",
              prompt: "Inspect repo",
              description: "Starting A",
            } as unknown as Part,
          ],
        },
        {
          info: {
            id: "msg-201",
            role: "assistant",
            time: { created: Date.parse("2026-02-17T12:00:02Z") },
          },
          parts: [
            {
              id: "tool-a",
              sessionID: "session-opencode-1",
              messageID: "msg-201",
              callID: "call-a",
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: {
                  subagent_type: "build",
                  prompt: "Inspect repo",
                  description: "Starting A",
                },
                metadata: {
                  externalSessionId: "child-a",
                },
                time: {
                  start: Date.parse("2026-02-17T12:00:01Z"),
                },
                title: "Task",
              },
            } as unknown as Part,
          ],
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await adapter.subscribeEvents(sessionRef("session-opencode-1"), () => {});

    const session = localSessions(adapter).get("session-opencode-1");
    if (!session) {
      throw new Error("Expected adapter session record");
    }

    expect(session.subagentCorrelationKeyByExternalSessionId.get("child-a")).toBe(
      "part:msg-200:subtask-a",
    );
    expect(session.pendingSubagentCorrelationKeys).toEqual([]);
    expect(session.pendingSubagentCorrelationKeysBySignature.size).toBe(0);
  });

  test("stopSession aborts session and emits finished event", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });
    await startDefaultSession(adapter);

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) => {
      events.push(event);
    });

    await adapter.stopSession(sessionRef("session-opencode-1"));

    expect(mock.session.abortCalls).toHaveLength(1);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("stopSession keeps the local session when runtime abort fails", async () => {
    const mock = makeMockClient({});
    const abortError = new Error("abort failed");
    const client = {
      ...mock.client,
      session: {
        ...mock.client.session,
        abort: async (input: unknown) => {
          mock.session.abortCalls.push(input);
          throw abortError;
        },
      },
    } as unknown as OpencodeClient;
    const adapter = new OpencodeSdkAdapter({
      createClient: () => client,
      now: () => "2026-02-17T12:00:00Z",
    });
    await startDefaultSession(adapter);

    const events: AgentEvent[] = [];
    await adapter.subscribeEvents(sessionRuntimeRef("session-opencode-1"), (event) => {
      events.push(event);
    });

    await expect(adapter.stopSession(sessionRef("session-opencode-1"))).rejects.toThrow(
      "abort failed",
    );

    expect(mock.session.abortCalls).toHaveLength(1);
    expect(localSessions(adapter).has("session-opencode-1")).toBe(true);
    expect(events.some((event) => event.type === "session_finished")).toBe(false);
  });
});
