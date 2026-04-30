import { describe, expect, mock, test } from "bun:test";
import { __testExports, sendUserMessage } from "./message-execution";
import type { SessionRecord } from "./types";
import {
  buildQueuedRequestAttachmentIdentitySignature,
  buildQueuedRequestSignature,
} from "./user-message-signatures";

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

const IMAGE_FILE_REFERENCE = {
  id: "file-assets-diagram",
  path: "assets/diagram.svg",
  name: "diagram.svg",
  kind: "image" as const,
};

const VIDEO_FILE_REFERENCE = {
  id: "file-recordings-demo",
  path: "recordings/demo.mov",
  name: "demo.mov",
  kind: "video" as const,
};

const IMAGE_ATTACHMENT = {
  id: "attachment-image-1",
  path: "/tmp/diagram.png",
  name: "diagram.png",
  kind: "image" as const,
  mime: "image/png",
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
      externalSessionId: "session-1",
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
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
        parts: [
          { kind: "slash_command", command: COMMAND },
          { kind: "text", text: " summarize latest session" },
        ],
      },
      tools: {},
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      {
        signature: buildQueuedRequestSignature(
          [
            { kind: "slash_command", command: COMMAND },
            { kind: "text", text: " summarize latest session" },
          ],
          undefined,
        ),
      },
    ]);
    expect(command).toHaveBeenCalledTimes(1);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  test("tracks queued file-reference sends using OpenCode-visible text and source spans", async () => {
    const { session, promptAsync } = createSession();
    session.activeAssistantMessageId = "msg-200";

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [{ kind: "file_reference", file: FILE_REFERENCE }],
      },
      tools: {},
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      {
        signature: buildQueuedRequestSignature(
          [{ kind: "file_reference", file: FILE_REFERENCE }],
          undefined,
        ),
      },
    ]);
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: "text", text: "@src/main.ts" },
          expect.objectContaining({
            type: "file",
            source: {
              type: "file",
              path: "src/main.ts",
              text: {
                value: "@src/main.ts",
                start: 0,
                end: 12,
              },
            },
          }),
        ],
      }),
    );
  });

  test("removes the exact queued slash follow-up entry when duplicate content send fails", async () => {
    const { session } = createSession({
      commandResult: {
        error: new Error("boom"),
        response: { status: 500, statusText: "Server Error" },
      },
    });
    session.activeAssistantMessageId = "msg-200";
    const preservedEntry = {
      signature: buildQueuedRequestSignature(
        [
          { kind: "slash_command", command: COMMAND },
          { kind: "text", text: " summarize latest session" },
        ],
        undefined,
      ),
    };
    session.pendingQueuedUserMessages = [preservedEntry];

    await expect(
      sendUserMessage({
        session,
        request: {
          externalSessionId: "session-1",
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
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
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

  test("routes local attachments through native prompt file parts without repo source text", async () => {
    const { session, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [
          { kind: "text", text: "describe this" },
          { kind: "attachment", attachment: IMAGE_ATTACHMENT },
        ],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      tools: {},
      parts: [
        { type: "text", text: "describe this" },
        {
          type: "file",
          mime: "image/png",
          url: "file:///tmp/diagram.png",
          filename: "diagram.png",
        },
      ],
    });
  });

  test("keeps file-reference spans aligned when attachments are skipped from prompt text", async () => {
    const { session, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [
          { kind: "text", text: "review " },
          { kind: "attachment", attachment: IMAGE_ATTACHMENT },
          { kind: "text", text: "with " },
          { kind: "file_reference", file: FILE_REFERENCE },
        ],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      tools: {},
      parts: [
        { type: "text", text: "review with @src/main.ts" },
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
              start: 12,
              end: 24,
            },
          },
        },
        {
          type: "file",
          mime: "image/png",
          url: "file:///tmp/diagram.png",
          filename: "diagram.png",
        },
      ],
    });
  });

  test("tracks attachment sends for transcript reconciliation even when the assistant is idle", async () => {
    const { session } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [{ kind: "attachment", attachment: IMAGE_ATTACHMENT }],
      },
      tools: {},
    });

    expect(session.pendingQueuedUserMessages).toEqual([
      {
        signature: buildQueuedRequestSignature(
          [{ kind: "attachment", attachment: IMAGE_ATTACHMENT }],
          undefined,
        ),
        attachmentIdentitySignature: buildQueuedRequestAttachmentIdentitySignature(
          [{ kind: "attachment", attachment: IMAGE_ATTACHMENT }],
          undefined,
        ),
        attachmentParts: [{ kind: "attachment", attachment: IMAGE_ATTACHMENT }],
      },
    ]);
  });

  test("omits file source metadata for local attachments so the runtime accepts the payload schema", async () => {
    const { session, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [{ kind: "attachment", attachment: IMAGE_ATTACHMENT }],
      },
      tools: {},
    });

    const promptRequest = promptAsync.mock.calls[0]?.[0] as
      | { parts?: Array<{ type: string; source?: unknown }> }
      | undefined;
    const attachmentPart = promptRequest?.parts?.find((part) => part.type === "file");
    expect(attachmentPart).toBeDefined();
    expect(attachmentPart?.source).toBeUndefined();
  });

  test("encodes file URLs for special characters and relative paths", async () => {
    const { session, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [
          {
            kind: "file_reference",
            file: {
              id: "file-special",
              path: "docs/guide?#.md",
              name: "guide?#.md",
              kind: "default",
            },
          },
        ],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: "text", text: "@docs/guide?#.md" },
          expect.objectContaining({
            type: "file",
            url: "file:///repo/docs/guide%3F%23.md",
            filename: "guide?#.md",
          }),
        ],
      }),
    );
  });

  test("uses media mime types for image and video file references", async () => {
    const { session, promptAsync } = createSession();

    await sendUserMessage({
      session,
      request: {
        externalSessionId: "session-1",
        parts: [
          { kind: "file_reference", file: IMAGE_FILE_REFERENCE },
          { kind: "text", text: " and " },
          { kind: "file_reference", file: VIDEO_FILE_REFERENCE },
        ],
      },
      tools: {},
    });

    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "session-opencode-1",
      directory: "/repo",
      tools: {},
      parts: [
        { type: "text", text: "@assets/diagram.svg and @recordings/demo.mov" },
        {
          type: "file",
          mime: "image/svg+xml",
          url: "file:///repo/assets/diagram.svg",
          filename: "diagram.svg",
          source: {
            type: "file",
            path: "assets/diagram.svg",
            text: {
              value: "@assets/diagram.svg",
              start: 0,
              end: 19,
            },
          },
        },
        {
          type: "file",
          mime: "video/quicktime",
          url: "file:///repo/recordings/demo.mov",
          filename: "demo.mov",
          source: {
            type: "file",
            path: "recordings/demo.mov",
            text: {
              value: "@recordings/demo.mov",
              start: 24,
              end: 44,
            },
          },
        },
      ],
    });
  });

  test("fails explicitly when a slash command message also contains a file reference", async () => {
    const { session } = createSession();

    await expect(
      sendUserMessage({
        session,
        request: {
          externalSessionId: "session-1",
          parts: [
            { kind: "slash_command", command: COMMAND },
            { kind: "file_reference", file: FILE_REFERENCE },
          ],
        },
        tools: {},
      }),
    ).rejects.toThrow(
      "OpenCode request failed: run slash command: OpenCode slash commands do not support structured attachments or file references.",
    );
  });

  test("fails explicitly when a slash command message also contains an attachment", async () => {
    const { session } = createSession();

    await expect(
      sendUserMessage({
        session,
        request: {
          externalSessionId: "session-1",
          parts: [
            { kind: "slash_command", command: COMMAND },
            { kind: "attachment", attachment: IMAGE_ATTACHMENT },
          ],
        },
        tools: {},
      }),
    ).rejects.toThrow(
      "OpenCode request failed: run slash command: OpenCode slash commands do not support structured attachments or file references.",
    );
  });

  test("fails explicitly when text appears before a slash command", () => {
    expect(() =>
      __testExports.toSlashCommandExecutionRequest([
        { kind: "text", text: "before " },
        { kind: "slash_command", command: COMMAND },
      ]),
    ).toThrow("OpenCode slash commands must be the first meaningful message segment.");
  });

  test("fails explicitly when a message contains multiple slash commands", () => {
    expect(() =>
      __testExports.toSlashCommandExecutionRequest([
        { kind: "slash_command", command: COMMAND },
        {
          kind: "slash_command",
          command: { ...COMMAND, id: "review", trigger: "review", title: "review" },
        },
      ]),
    ).toThrow("OpenCode supports only one slash command token per message.");
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
          externalSessionId: "session-1",
          parts: [{ kind: "slash_command", command: COMMAND }],
        },
        tools: {},
      }),
    ).rejects.toThrow(
      "OpenCode request failed: run slash command (400 Bad Request): bad command payload",
    );
  });
});
