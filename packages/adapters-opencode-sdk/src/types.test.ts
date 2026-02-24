import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  ClientFactory,
  McpServerStatus,
  OpencodeSdkAdapterOptions,
  SessionInput,
  SessionRecord,
} from "./types";

const createClient: ClientFactory = () => {
  return {} as OpencodeClient;
};

describe("types", () => {
  test("exports adapter contract types that can be instantiated", () => {
    const sessionInput: SessionInput = {
      sessionId: "session-1",
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      systemPrompt: "system",
      baseUrl: "http://127.0.0.1:12345",
    };
    const sessionRecord: SessionRecord = {
      summary: {
        sessionId: "session-1",
        externalSessionId: "external-session-1",
        role: "spec",
        scenario: "spec_initial",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: "running",
      },
      input: sessionInput,
      client: createClient({
        baseUrl: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      }),
      externalSessionId: "external-session-1",
      streamAbortController: new AbortController(),
      streamDone: Promise.resolve(),
      emittedAssistantMessageIds: new Set<string>(),
    };
    const status: McpServerStatus = { status: "connected" };
    const options: OpencodeSdkAdapterOptions = {
      now: () => "2026-02-22T12:00:00.000Z",
      createClient,
      logEvent: () => undefined,
    };

    expect(sessionRecord.input.sessionId).toBe("session-1");
    expect(status.status).toBe("connected");
    expect(typeof options.createClient).toBe("function");
    expect(typeof options.logEvent).toBe("function");
  });
});
