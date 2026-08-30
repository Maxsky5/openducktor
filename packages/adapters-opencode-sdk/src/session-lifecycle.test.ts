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

describe("OpencodeSdkAdapter session lifecycle", () => {
  test("subscribeEvents prepares existing session state without loading history or emitting a started event", async () => {
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
            } satisfies Part,
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
    expect(mock.session.messagesCalls).toHaveLength(0);
    expect(events).toEqual([]);
  });

  test("subscribeEvents rejects an existing session ref for another working directory", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const unsubscribe = await adapter.subscribeEvents(
      sessionRuntimeRef("session-opencode-1"),
      () => {},
    );

    await expect(
      adapter.subscribeEvents(
        {
          ...sessionRuntimeRef("session-opencode-1"),
          workingDirectory: "/repo/worktrees/session-opencode-1",
        },
        () => {},
      ),
    ).rejects.toThrow("registered session belongs");
    unsubscribe();
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

  test("releaseSession rejects a ref for another working directory", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });
    await startDefaultSession(adapter);

    await expect(
      adapter.releaseSession({
        ...sessionRef("session-opencode-1"),
        workingDirectory: "/repo/worktrees/session-opencode-1",
      }),
    ).rejects.toThrow("registered session belongs");

    await adapter.stopSession(sessionRef("session-opencode-1"));
    expect(mock.session.abortCalls).toHaveLength(1);
  });

  test("stopSession rejects a ref for another working directory before aborting", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });
    await startDefaultSession(adapter);

    await expect(
      adapter.stopSession({
        ...sessionRef("session-opencode-1"),
        workingDirectory: "/repo/worktrees/session-opencode-1",
      }),
    ).rejects.toThrow("registered session belongs");

    expect(mock.session.abortCalls).toHaveLength(0);
  });

  test("stopSession keeps the local session when runtime abort fails", async () => {
    const mock = makeMockClient({});
    const abortError = new Error("abort failed");
    let abortShouldFail = true;
    const client: OpencodeClient = {
      ...mock.client,
      session: {
        ...mock.client.session,
        abort: async (input: Parameters<OpencodeClient["session"]["abort"]>[0]) => {
          mock.session.abortCalls.push(input);
          if (abortShouldFail) {
            abortShouldFail = false;
            throw abortError;
          }
          return { data: true, error: undefined };
        },
      },
    };
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
    expect(events.some((event) => event.type === "session_finished")).toBe(false);

    await adapter.stopSession(sessionRef("session-opencode-1"));
    expect(mock.session.abortCalls).toHaveLength(2);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });
});
