import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { OpencodeSdkAdapter } from "./opencode-sdk-adapter";

const makeMockClient = (): {
  client: OpencodeClient;
  createCalls: unknown[];
  abortCalls: unknown[];
} => {
  const createCalls: unknown[] = [];
  const abortCalls: unknown[] = [];

  const client = {
    session: {
      create: async (input: unknown) => {
        createCalls.push(input);
        return { data: { id: "external-session-1" }, error: undefined };
      },
      abort: async (input: unknown) => {
        abortCalls.push(input);
        return { data: true, error: undefined };
      },
    },
    event: {
      subscribe: async () => {
        async function* iterator(): AsyncGenerator<Event> {
          for (const event of [] as Event[]) {
            yield event;
          }
          return;
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;

  return { client, createCalls, abortCalls };
};

describe("opencode-sdk-adapter", () => {
  test("startSession registers and stopSession tears down the session", async () => {
    const mock = makeMockClient();
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-22T12:00:00.000Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-1", (event) => {
      events.push(event);
    });

    const summary = await adapter.startSession({
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
      runtimeConnection: {
        endpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
    });

    expect(summary.sessionId).toBe("session-1");
    expect(summary.externalSessionId).toBe("external-session-1");
    expect(adapter.hasSession("session-1")).toBe(true);
    expect(mock.createCalls).toHaveLength(1);

    await adapter.stopSession("session-1");

    expect(mock.abortCalls).toHaveLength(1);
    expect(adapter.hasSession("session-1")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });
});
