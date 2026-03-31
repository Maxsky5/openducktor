import { describe, expect, mock, test } from "bun:test";
import { __testExports, sendUserMessage } from "./message-execution";
import type { SessionRecord } from "./types";

const COMMAND = {
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: ["compact"],
};

const FILE_REFERENCE = {
  id: "file-src-main",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code" as const,
};

const createSession = (overrides?: {
  commandResult?: { data?: unknown; error?: unknown; response?: unknown };
  promptAsyncResult?: { data?: unknown; error?: unknown; response?: unknown };
}) => {
  const command = mock(async () => overrides?.commandResult ?? { error: null });
  const promptAsync = mock(async () => overrides?.promptAsyncResult ?? { error: null });

  const session = {
    externalSessionId: "session-opencode-1",
    input: {
      sessionId: "session-1",
      role: "build",
      taskId: "task-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      systemPrompt: "",
      model: null,
    },
    client: {
      session: {
        command,
        promptAsync,
      },
    },
    activeAssistantMessageId: null,
    pendingQueuedUserMessages: [],
    hasIdleSinceActivity: true,
  } as unknown as SessionRecord;

  return { session, command, promptAsync };
};

describe("message-execution", () => {
  test("normalizes a slash command token into a runtime execution request", () => {
    expect(
      __testExports.toSlashCommandExecutionRequest([
        { kind: "slash_command", command: COMMAND },
        { kind: "text", text: " summarize latest session " },
      ]),
    ).toEqual({
      command: "compact",
      arguments: "summarize latest session",
    });
  });

  test("routes slash command messages through the native command transport", async () => {
    const { session, command, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [
          { kind: "slash_command", command: COMMAND },
          { kind: "text", text: " summarize latest session " },
        ],
        model: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "hephaestus",
        },
      },
      tools: {},
    });

    expect(command).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      command: "compact",
      arguments: "summarize latest session",
      model: "openai/gpt-5",
      variant: "high",
      agent: "hephaestus",
    });
    expect(promptAsync).not.toHaveBeenCalled();
  });

  test("tracks busy slash command sends as queued follow-ups through the shared pre-send flow", async () => {
    const { session, command, promptAsync } = createSession();
    session.activeAssistantMessageId = "msg-200";

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [
          { kind: "slash_command", command: COMMAND },
          { kind: "text", text: " summarize latest session" },
        ],
      },
      tools: {},
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      { content: "/compact summarize latest session" },
    ]);
    expect(command).toHaveBeenCalledTimes(1);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  test("removes the exact queued slash follow-up entry when duplicate content send fails", async () => {
    const { session } = createSession({
      commandResult: {
        error: new Error("boom"),
        response: { status: 500, statusText: "Server Error" },
      },
    });
    session.activeAssistantMessageId = "msg-200";
    const preservedEntry = { content: "/compact summarize latest session" };
    session.pendingQueuedUserMessages = [preservedEntry];

    await expect(
      sendUserMessage({
        session,
        request: {
          sessionId: "session-1",
          parts: [
            { kind: "slash_command", command: COMMAND },
            { kind: "text", text: " summarize latest session" },
          ],
        },
        tools: {},
      }),
    ).rejects.toThrow();

    expect(session.pendingQueuedUserMessages).toEqual([preservedEntry]);
  });

  test("hydrates the pending assistant boundary from slash-command responses", async () => {
    const { session } = createSession({
      commandResult: {
        data: {
          info: {
            id: "msg-assistant-1",
          },
        },
        error: null,
      },
    });

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [{ kind: "slash_command", command: COMMAND }],
      },
      tools: {},
    });

    expect(session.activeAssistantMessageId).toBe("msg-assistant-1");
  });

  test("routes regular text messages through the prompt transport", async () => {
    const { session, command, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [{ kind: "text", text: "plain follow-up" }],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      tools: {},
      parts: [{ type: "text", text: "plain follow-up" }],
    });
    expect(command).not.toHaveBeenCalled();
  });

  test("routes file references through native prompt file parts", async () => {
    const { session, command, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [
          { kind: "text", text: "check " },
          { kind: "file_reference", file: FILE_REFERENCE },
          { kind: "text", text: " please" },
        ],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      tools: {},
      parts: [
        { type: "text", text: "check @src/main.ts please" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/main.ts",
          filename: "main.ts",
          source: {
            type: "file",
            path: "src/main.ts",
            text: {
              value: "@src/main.ts",
              start: 6,
              end: 18,
            },
          },
        },
      ],
    });
    expect(command).not.toHaveBeenCalled();
  });

  test("fails explicitly when a slash command message also contains a file reference", async () => {
    const { session } = createSession();

    await expect(
      sendUserMessage({
        session,
        request: {
          sessionId: "session-1",
          parts: [
            { kind: "slash_command", command: COMMAND },
            { kind: "file_reference", file: FILE_REFERENCE },
          ],
        },
        tools: {},
      }),
    ).rejects.toThrow(
      "OpenCode request failed: run slash command: OpenCode slash commands do not support structured file references.",
    );
  });

  test("preserves slash-command error context without wrapping it as a prompt failure", async () => {
    const { session } = createSession();
    session.client.session.command = mock(async () => ({
      error: new Error("bad command payload"),
      response: { status: 400, statusText: "Bad Request" },
    }));

    await expect(
      sendUserMessage({
        session,
        request: {
          sessionId: "session-1",
          parts: [{ kind: "slash_command", command: COMMAND }],
        },
        tools: {},
      }),
    ).rejects.toThrow(
      "OpenCode request failed: run slash command (400 Bad Request): bad command payload",
    );
  });
});
