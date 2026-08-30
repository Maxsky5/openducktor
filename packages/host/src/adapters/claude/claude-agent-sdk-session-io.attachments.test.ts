import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { applyClaudeSessionModel, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";
import type { ClaudeSession } from "./claude-agent-sdk-types";

describe("Claude session I/O attachments and invalid updates", () => {
  test("queues structured Claude SDK messages with staged image attachments", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-send-"));
    try {
      const imagePath = join(workspace, "screenshot.png");
      await writeFile(imagePath, Buffer.from("png-bytes"));
      const pushed: SDKUserMessage[] = [];
      const queue = new AsyncInputQueue<SDKUserMessage>();
      queue.push = (message) => {
        pushed.push(message);
      };
      const session = createClaudeSession({
        activity: "idle",
        query: createClaudeQueryFixture({
          applyFlagSettings: mock(async () => {}),
          setModel: mock(async (_model?: string) => {}),
        }),
        queue,
      });

      const messageId = "00000000-0000-4000-8000-000000000001";
      const accepted = await sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => messageId,
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [
            { kind: "text", text: "Inspect this" },
            {
              kind: "attachment",
              attachment: {
                id: "attachment-1",
                kind: "image",
                mime: "image/png",
                name: "screenshot.png",
                path: imagePath,
              },
            },
          ],
        },
      });

      expect(accepted).toMatchObject({
        messageId,
        message: "Inspect this",
        parts: [
          { kind: "text", text: "Inspect this" },
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              name: "screenshot.png",
              path: imagePath,
            },
          },
        ],
      });
      expect(pushed).toEqual([
        {
          type: "user",
          uuid: messageId,
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:00.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [
              { type: "text", text: "Inspect this" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: Buffer.from("png-bytes").toString("base64"),
                },
              },
            ],
          },
        },
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("rejects oversized Claude attachments before reading them", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-send-"));
    try {
      const imagePath = join(workspace, "large-screenshot.png");
      await writeFile(imagePath, "");
      await truncate(imagePath, 32 * 1024 * 1024 + 1);

      await expect(
        toClaudeMessageFromParts([
          {
            kind: "attachment",
            attachment: {
              id: "attachment-1",
              kind: "image",
              mime: "image/png",
              name: "large-screenshot.png",
              path: imagePath,
            },
          },
        ]),
      ).rejects.toThrow("Claude attachments exceed the 32 MiB input memory budget.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("preserves text boundaries around attachments in accepted messages", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openducktor-claude-send-"));
    try {
      const documentPath = join(workspace, "context.pdf");
      await writeFile(documentPath, Buffer.from("pdf-bytes"));
      const session = createClaudeSession({
        activity: "idle",
        query: createClaudeQueryFixture({
          applyFlagSettings: mock(async () => {}),
          setModel: mock(async (_model?: string) => {}),
        }),
      });

      const accepted = await sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "00000000-0000-4000-8000-000000000002",
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [
            { kind: "text", text: "Before" },
            {
              kind: "attachment",
              attachment: {
                id: "attachment-1",
                kind: "pdf",
                mime: "application/pdf",
                name: "context.pdf",
                path: documentPath,
              },
            },
            {
              kind: "file_reference",
              file: {
                id: "src/after.ts",
                kind: "code",
                name: "after.ts",
                path: "src/after.ts",
              },
            },
          ],
        },
      });

      expect(accepted.message).toBe("Before\n@src/after.ts");
      expect(accepted.parts.at(-1)).toEqual({
        kind: "file_reference",
        file: {
          id: "src/after.ts",
          kind: "code",
          name: "after.ts",
          path: "src/after.ts",
        },
        sourceText: {
          value: "@src/after.ts",
          start: 7,
          end: 20,
        },
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("rejects unsupported live Claude effort changes without mutating session model", async () => {
    const applyFlagSettings = mock(async () => {});
    const session = createClaudeSession({
      model: {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings,
        setModel: mock(async (_model?: string) => {}),
      }),
    });

    await expect(
      applyClaudeSessionModel(session, {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "max",
      }),
    ).rejects.toThrow("Claude Agent SDK live effort updates do not support 'max'.");

    expect(applyFlagSettings).not.toHaveBeenCalled();
    expect(session.model?.variant).toBe("high");
  });

  test("rolls back the SDK model when a combined model and effort update fails", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(
      async (settings: Parameters<ClaudeSession["query"]["applyFlagSettings"]>[0]) => {
        if (settings.effortLevel === "xhigh") {
          throw new Error("effort update failed");
        }
      },
    );
    const session = createClaudeSession({
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings,
        setModel,
      }),
    });

    await expect(
      applyClaudeSessionModel(session, {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "xhigh",
      }),
    ).rejects.toThrow("effort update failed");

    expect(setModel.mock.calls).toEqual([["claude-opus-4-6"], ["claude-sonnet-4-6"]]);
    expect(applyFlagSettings.mock.calls).toEqual([
      [{ effortLevel: "xhigh" }],
      [{ effortLevel: "high" }],
    ]);
    expect(session.model).toMatchObject({
      modelId: "claude-sonnet-4-6",
      variant: "high",
    });
  });
});
