import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import {
  extractMessageTotalTokens,
  normalizeUserMessageDisplayParts,
  readMessageModelSelection,
  readTextFromParts,
  readVisibleUserTextFromDisplayParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";

describe("message-normalizers", () => {
  test("readTextFromParts joins only text parts", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "First line",
      } as Part,
      {
        id: "reason-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "reasoning",
        text: "Should be ignored",
      } as Part,
      {
        id: "text-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "Second line",
      } as Part,
    ];

    expect(readTextFromParts(parts)).toBe("First line\nSecond line");
  });

  test("normalizes user display parts by filtering synthetic text and preserving file refs", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "check @src/main.ts please",
      } as Part,
      {
        id: "text-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: 'Called the Read tool with the following input: {"filePath":"src/main.ts"}',
        synthetic: true,
      } as Part,
      {
        id: "file-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "text/plain",
        filename: "main.ts",
        url: "file:///repo/src/main.ts",
        source: {
          type: "file",
          path: "src/main.ts",
          text: {
            value: "@src/main.ts",
            start: 6,
            end: 19,
          },
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "text",
        text: "check @src/main.ts please",
      },
      {
        kind: "file_reference",
        file: {
          id: "file-1",
          path: "src/main.ts",
          name: "main.ts",
          kind: "code",
        },
        sourceText: {
          value: "@src/main.ts",
          start: 6,
          end: 19,
        },
      },
    ]);
  });

  test("ignores malformed source text payloads when normalizing file references", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "file-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "text/plain",
        filename: "main.ts",
        url: "file:///repo/src/main.ts",
        source: {
          type: "file",
          path: "src/main.ts",
          text: {
            value: "@src/main.ts",
            start: "6",
            end: 19,
          },
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "file_reference",
        file: {
          id: "file-1",
          path: "src/main.ts",
          name: "main.ts",
          kind: "code",
        },
      },
    ]);
  });

  test("normalizes OpenCode agent parts into subagent display parts", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "ask @reviewer now",
      } as Part,
      {
        id: "agent-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "agent",
        name: "reviewer",
        source: {
          value: "@reviewer",
          start: 4,
          end: 13,
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "text",
        text: "ask @reviewer now",
      },
      {
        kind: "subagent_reference",
        subagent: {
          id: "reviewer",
          name: "reviewer",
          label: "reviewer",
        },
        sourceText: {
          value: "@reviewer",
          start: 4,
          end: 13,
        },
      },
    ]);
  });

  test("keeps only the slash-command envelope text when OpenCode echoes instruction text separately", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "slash-envelope",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "<auto-slash-command>\n# /test-command Command\n\n## User Request\n\npouet\n</auto-slash-command>",
      } as Part,
      {
        id: "slash-echo",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "I just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet",
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "text",
        text: "<auto-slash-command>\n# /test-command Command\n\n## User Request\n\npouet\n</auto-slash-command>",
      },
    ]);
  });

  test("normalizes local multimodal file parts into attachment display parts", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "image-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "image/png",
        filename: "diagram.png",
        url: "file:///tmp/diagram.png",
      } as Part,
      {
        id: "audio-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "audio/mpeg",
        filename: "meeting.mp3",
        url: "file:///tmp/meeting.mp3",
      } as Part,
      {
        id: "video-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "video/mp4",
        filename: "demo.mp4",
        url: "file:///tmp/demo.mp4",
      } as Part,
      {
        id: "pdf-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "application/pdf",
        filename: "spec.pdf",
        url: "file:///tmp/spec.pdf",
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "attachment",
        attachment: {
          id: "image-1",
          path: "/tmp/diagram.png",
          name: "diagram.png",
          kind: "image",
          mime: "image/png",
        },
      },
      {
        kind: "attachment",
        attachment: {
          id: "audio-1",
          path: "/tmp/meeting.mp3",
          name: "meeting.mp3",
          kind: "audio",
          mime: "audio/mpeg",
        },
      },
      {
        kind: "attachment",
        attachment: {
          id: "video-1",
          path: "/tmp/demo.mp4",
          name: "demo.mp4",
          kind: "video",
          mime: "video/mp4",
        },
      },
      {
        kind: "attachment",
        attachment: {
          id: "pdf-1",
          path: "/tmp/spec.pdf",
          name: "spec.pdf",
          kind: "pdf",
          mime: "application/pdf",
        },
      },
    ]);
  });

  test("keeps attachment echoes as attachments when runtime adds non-@ source text", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "pdf-runtime-echo",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "application/pdf",
        filename: "brief.pdf",
        url: "file:///tmp/brief.pdf",
        source: {
          type: "file",
          path: "brief.pdf",
          text: {
            value: "brief.pdf",
            start: 0,
            end: 9,
          },
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "attachment",
        attachment: {
          id: "pdf-runtime-echo",
          path: "/tmp/brief.pdf",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
        },
      },
    ]);
  });

  test("preserves raw filesystem paths returned in attachment urls", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "image-raw-path",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "image/png",
        filename: "Screenshot 2026-04-01 at 00.33.32.png",
        url: "/var/folders/example/Screenshot 2026-04-01 at 00.33.32.png",
      } as Part,
      {
        id: "image-windows-path",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "image/png",
        filename: "",
        url: "C:\\Temp\\Preview.png",
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "attachment",
        attachment: {
          id: "image-raw-path",
          path: "/var/folders/example/Screenshot 2026-04-01 at 00.33.32.png",
          name: "Screenshot 2026-04-01 at 00.33.32.png",
          kind: "image",
          mime: "image/png",
        },
      },
      {
        kind: "attachment",
        attachment: {
          id: "image-windows-path",
          path: "C:\\Temp\\Preview.png",
          name: "Preview.png",
          kind: "image",
          mime: "image/png",
        },
      },
    ]);
  });

  test("falls back to source file path for attachments when the runtime omits a file url", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "image-source-path",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "image/png",
        filename: "Screenshot 2026-04-01 at 00.33.32.png",
        url: "",
        source: {
          type: "file",
          path: "/var/folders/example/Screenshot 2026-04-01 at 00.33.32.png",
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "attachment",
        attachment: {
          id: "image-source-path",
          path: "/var/folders/example/Screenshot 2026-04-01 at 00.33.32.png",
          name: "Screenshot 2026-04-01 at 00.33.32.png",
          kind: "image",
          mime: "image/png",
        },
      },
    ]);
  });

  test("normalizes only supported media file attachments without inline source text", () => {
    // SAFETY: This test controls the fixture and supplies `Part` used by this case.
    const parts: Part[] = [
      {
        id: "file-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "text/plain",
        filename: "styles.scss",
        url: "file:///repo/src/styles.scss",
        source: {
          type: "file",
          path: "src/styles.scss",
        },
      } as Part,
      {
        id: "file-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "image/webp",
        filename: "preview.webp",
        url: "file:///repo/assets/preview.webp",
        source: {
          type: "file",
          path: "assets/preview.webp",
        },
      } as Part,
      {
        id: "file-3",
        sessionID: "session-1",
        messageID: "message-1",
        type: "file",
        mime: "video/webm",
        filename: "demo.webm",
        url: "file:///repo/recordings/demo.webm",
        source: {
          type: "file",
          path: "recordings/demo.webm",
        },
      } as Part,
    ];

    expect(normalizeUserMessageDisplayParts(parts)).toEqual([
      {
        kind: "attachment",
        attachment: {
          id: "file-2",
          path: "/repo/assets/preview.webp",
          name: "preview.webp",
          kind: "image",
          mime: "image/webp",
        },
      },
      {
        kind: "attachment",
        attachment: {
          id: "file-3",
          path: "/repo/recordings/demo.webm",
          name: "demo.webm",
          kind: "video",
          mime: "video/webm",
        },
      },
    ]);
  });

  test("reads visible user text from display parts without synthetic runtime text", () => {
    expect(
      readVisibleUserTextFromDisplayParts([
        { kind: "text", text: "check @src/main.ts please" },
        {
          kind: "file_reference",
          file: {
            id: "file-1",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/main.ts",
            start: 6,
            end: 19,
          },
        },
      ]),
    ).toBe("check @src/main.ts please");

    expect(
      readVisibleUserTextFromDisplayParts([
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            path: "/tmp/diagram.png",
            name: "diagram.png",
            kind: "image",
            mime: "image/png",
          },
        },
        {
          kind: "file_reference",
          file: {
            id: "file-2",
            path: "src/only.ts",
            name: "only.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/only.ts",
            start: 0,
            end: 12,
          },
        },
      ]),
    ).toBe("@src/only.ts");

    expect(
      readVisibleUserTextFromDisplayParts([
        {
          kind: "attachment",
          attachment: {
            id: "attachment-2",
            path: "/tmp/spec.pdf",
            name: "spec.pdf",
            kind: "pdf",
            mime: "application/pdf",
          },
        },
      ]),
    ).toBe("");

    expect(
      readVisibleUserTextFromDisplayParts([
        { kind: "text", text: "  keep boundary whitespace  " },
        {
          kind: "text",
          text: "ignored synthetic",
          synthetic: true,
        },
      ]),
    ).toBe("  keep boundary whitespace  ");

    expect(
      readVisibleUserTextFromDisplayParts([
        {
          kind: "file_reference",
          file: {
            id: "file-3",
            path: "src/alpha.ts",
            name: "alpha.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/alpha.ts",
            start: 0,
            end: 13,
          },
        },
        {
          kind: "file_reference",
          file: {
            id: "file-4",
            path: "src/beta.ts",
            name: "beta.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/beta.ts",
            start: 13,
            end: 25,
          },
        },
        {
          kind: "text",
          text: "ignored synthetic",
          synthetic: true,
        },
      ]),
    ).toBe("@src/alpha.ts @src/beta.ts");

    expect(
      readVisibleUserTextFromDisplayParts([
        {
          kind: "subagent_reference",
          subagent: {
            id: "reviewer",
            name: "reviewer",
            label: "Reviewer",
          },
          sourceText: {
            value: "@reviewer",
            start: 0,
            end: 9,
          },
        },
      ]),
    ).toBe("@reviewer");
  });

  test("sanitizeAssistantMessage trims surrounding whitespace", () => {
    expect(sanitizeAssistantMessage("  done  ")).toBe("done");
  });

  test("readMessageModelSelection supports assistant and user message shapes", () => {
    expect(
      readMessageModelSelection({
        id: "assistant-1",
        sessionID: "session-1",
        role: "assistant",
        time: { created: 1 },
        providerID: "openai",
        modelID: "gpt-5",
        parentID: "user-1",
        mode: "build",
        agent: "Hephaestus",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        variant: "high",
      }),
    ).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });

    expect(
      readMessageModelSelection({
        id: "user-1",
        sessionID: "session-1",
        role: "user",
        time: { created: 1 },
        model: {
          providerID: "anthropic",
          modelID: "claude-3-7-sonnet",
          variant: "max",
        },
        agent: "Ares",
      }),
    ).toEqual({
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Ares",
      variant: "max",
    });
  });

  test("extractMessageTotalTokens prefers info token breakdown", () => {
    const info = {
      id: "assistant-1",
      sessionID: "session-1",
      role: "assistant",
      time: { created: 1 },
      parentID: "user-1",
      providerID: "openai",
      modelID: "gpt-5",
      mode: "build",
      agent: "build",
      path: { cwd: "/repo", root: "/repo" },
      cost: 0,
      tokens: {
        input: 300,
        output: 120,
        reasoning: 30,
        cache: {
          read: 20,
          write: 10,
        },
      },
    };

    const total = extractMessageTotalTokens(info, []);
    expect(total).toBe(480);
  });

  test("extractMessageTotalTokens falls back to max part token total", () => {
    const parts: Part[] = [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "step-finish",
        cost: 0,
        reason: "stop",
        tokens: {
          total: 42,
          input: 10,
          output: 30,
          reasoning: 2,
          cache: { read: 0, write: 0 },
        },
      },
      {
        id: "part-2",
        sessionID: "session-1",
        messageID: "assistant-1",
        type: "step-finish",
        cost: 0,
        reason: "stop",
        tokens: {
          input: 10,
          output: 60,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
    ];

    const total = extractMessageTotalTokens({}, parts);
    expect(total).toBe(70);
  });

  test("extractMessageTotalTokens ignores malformed nested token payloads", () => {
    const total = extractMessageTotalTokens(
      {
        tokens: {
          input: "300",
          cache: {
            read: "10",
          },
        },
      },
      [
        {
          id: "part-1",
          tokens: {
            input: 2,
            output: "60",
          },
        },
        {
          id: "part-2",
          tokens: {
            input: 10,
            output: 5,
            cache: {
              read: 2,
            },
          },
        },
      ],
    );

    expect(total).toBeUndefined();
  });
});
