import { describe, expect, test } from "bun:test";
import { workflowAgentSessionScope } from "@openducktor/core";
import { makeMockClient, OpencodeSdkAdapter, sessionRuntimeRef } from "./test-support";

const sessionScope = workflowAgentSessionScope("task-1", "build");

const userEntry = (id: string, createdAt: number) => ({
  info: { id, role: "user", sessionID: "session-opencode-1", time: { created: createdAt } },
  parts: [
    {
      id: `${id}-part-1`,
      sessionID: "session-opencode-1",
      messageID: id,
      type: "text",
      text: "Interrupted request",
    },
  ],
});

const assistantEntry = (id: string, createdAt: number) => ({
  info: { id, role: "assistant", sessionID: "session-opencode-1", time: { created: createdAt } },
  parts: [],
});

const interruptedMessages = () => [userEntry("user-1", 1), assistantEntry("assistant-1", 2)];

describe("OpencodeSdkAdapter interrupted-turn continuation", () => {
  test("continues an unloaded session with the requested model and system prompt", async () => {
    const mock = makeMockClient({ messagesResponse: interruptedMessages() });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    const summary = await adapter.continueInterruptedTurn({
      ...sessionRuntimeRef("session-opencode-1", { sessionScope }),
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      systemPrompt: "Keep the stored plan.",
    });

    expect(summary).toMatchObject({
      externalSessionId: "session-opencode-1",
      runtimeKind: "opencode",
    });
    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      sessionID: "session-opencode-1",
      directory: "/repo",
      parts: [],
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "medium",
      system: "Keep the stored plan.",
    });
  });

  test("probes the turn state before registering an unloaded session", async () => {
    const completedAssistant = {
      info: {
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-opencode-1",
        finish: "stop",
        time: { created: 2, completed: 3 },
      },
      parts: [],
    };
    const mock = makeMockClient({
      messagesResponse: [userEntry("user-1", 1), completedAssistant],
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    await expect(
      adapter.continueInterruptedTurn({
        ...sessionRuntimeRef("session-opencode-1", { sessionScope }),
        model: { providerId: "openai", modelId: "gpt-5" },
      }),
    ).rejects.toMatchObject({ reason: "completed_turn" });

    expect(mock.session.statusCalls.length).toBeGreaterThan(0);
    expect(mock.session.getCalls).toHaveLength(0);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("reports a missing session as session_not_found", async () => {
    const mock = makeMockClient({ messagesResponse: interruptedMessages() });
    const get = mock.client.session.get;
    mock.client.session.get = async (...args) => ({
      ...(await get(...args)),
      data: undefined,
      error: { message: "Session not found" },
      response: { status: 404, statusText: "Not Found" },
    });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });

    await expect(
      adapter.continueInterruptedTurn({
        ...sessionRuntimeRef("missing-session", { sessionScope }),
        model: { providerId: "openai", modelId: "gpt-5" },
        systemPrompt: "Keep the stored plan.",
      }),
    ).rejects.toMatchObject({ reason: "session_not_found" });
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("reports a registered-session identity mismatch as identity_mismatch", async () => {
    const mock = makeMockClient({ messagesResponse: interruptedMessages() });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const ref = sessionRuntimeRef("session-opencode-1", { sessionScope });
    await adapter.resumeSession(ref);

    await expect(
      adapter.continueInterruptedTurn({ ...ref, workingDirectory: "/other-worktree" }),
    ).rejects.toMatchObject({ reason: "identity_mismatch" });
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("rejects a continuation whose session scope conflicts with the attached session", async () => {
    const mock = makeMockClient({ messagesResponse: interruptedMessages() });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const ref = sessionRuntimeRef("session-opencode-1", { sessionScope });
    await adapter.resumeSession(ref);
    const statusCallsAfterResume = mock.session.statusCalls.length;
    const getCallsAfterResume = mock.session.getCalls.length;

    await expect(
      adapter.continueInterruptedTurn({
        ...ref,
        sessionScope: workflowAgentSessionScope("task-2", "build"),
      }),
    ).rejects.toMatchObject({
      reason: "identity_mismatch",
      message: expect.stringContaining("does not match the requested"),
    });

    expect(mock.session.statusCalls.length).toBe(statusCallsAfterResume);
    expect(mock.session.getCalls.length).toBe(getCallsAfterResume);
    expect(mock.session.promptAsyncCalls).toHaveLength(0);
  });

  test("prefers the request model and system prompt over the loaded session values", async () => {
    const mock = makeMockClient({ messagesResponse: interruptedMessages() });
    const adapter = new OpencodeSdkAdapter({ createClient: () => mock.client });
    const ref = sessionRuntimeRef("session-opencode-1", { sessionScope });
    await adapter.resumeSession({
      ...ref,
      model: { providerId: "openai", modelId: "gpt-5", variant: "low" },
      systemPrompt: "Loaded system prompt.",
    });

    await adapter.continueInterruptedTurn({
      ...ref,
      model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      systemPrompt: "Prepared system prompt.",
    });

    expect(mock.session.promptAsyncCalls).toHaveLength(1);
    expect(mock.session.promptAsyncCalls[0]).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
      system: "Prepared system prompt.",
    });
  });
});
