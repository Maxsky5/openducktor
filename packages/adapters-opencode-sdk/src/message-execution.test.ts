import { describe, expect, mock, test } from "bun:test";
import { __testExports, sendUserMessage } from "./message-execution";
import type { SessionRecord } from "./types";

const COMMAND = {
  id: "compact",
  trigger: "compact",
  title: "compact",
  hints: ["compact"],
};

const createSession = () => {
  const command = mock(async () => ({ error: null }));
  const promptAsync = mock(async () => ({ error: null }));

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

  test("routes slash command messages through the runtime command client", async () => {
    const { session, command, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        sessionId: "session-1",
        parts: [
          { kind: "slash_command", command: COMMAND },
          { kind: "text", text: " summarize latest session " },
        ],
      },
      tools: {},
    });

    expect(command).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      command: "compact",
      arguments: "summarize latest session",
    });
    expect(promptAsync).not.toHaveBeenCalled();
  });
});
