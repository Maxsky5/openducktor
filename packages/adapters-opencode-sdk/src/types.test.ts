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
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "spec",
      systemPrompt: "system",
    };
    const sessionRecord: SessionRecord = {
      summary: {
        externalSessionId: "external-session-1",
        role: "spec",
        startedAt: "2026-02-22T12:00:00.000Z",
        status: "running",
      },
      input: sessionInput,
      client: createClient({
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      }),
      externalSessionId: "external-session-1",
      eventTransportKey: "http://127.0.0.1:12345",
      hasIdleSinceActivity: false,
      activeAssistantMessageId: null,
      completedAssistantMessageIds: new Set<string>(),
      emittedAssistantMessageIds: new Set<string>(),
      emittedUserMessageSignatures: new Map<string, string>(),
      emittedUserMessageStates: new Map(),
      pendingQueuedUserMessages: [],
      partsById: new Map(),
      messageRoleById: new Map(),
      messageMetadataById: new Map(),
      pendingDeltasByPartId: new Map(),
      subagentCorrelationKeyByPartId: new Map(),
      subagentCorrelationKeyByExternalSessionId: new Map(),
      pendingSubagentCorrelationKeysBySignature: new Map(),
      pendingSubagentCorrelationKeys: [],
      pendingSubagentSessionsByExternalSessionId: new Map(),
      pendingSubagentPartEmissionsByExternalSessionId: new Map(),
    };
    const status: McpServerStatus = { status: "connected" };
    const options: OpencodeSdkAdapterOptions = {
      now: () => "2026-02-22T12:00:00.000Z",
      createClient,
      logEvent: () => undefined,
    };

    expect(sessionRecord.summary.externalSessionId).toBe("external-session-1");
    expect(status.status).toBe("connected");
    expect(typeof options.createClient).toBe("function");
    expect(typeof options.logEvent).toBe("function");
  });
});
