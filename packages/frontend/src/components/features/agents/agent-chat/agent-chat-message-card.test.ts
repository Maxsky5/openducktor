import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createCodexMessageCardTestProps,
  createMessageCardElement,
  LONG_TRANSCRIPT_SAMPLE,
  renderMessageCardToHtml,
} from "./agent-chat-message-card-test-harness";

describe("AgentChatMessageCard messages", () => {
  test("renders assistant footer with agent, provider/model, and variant labels", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "Implemented the requested changes.",
          timestamp: "2026-02-22T10:23:00.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
            profileId: "planner-main",
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            variant: "high",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("planner-main");
    expect(html).toContain("openai/gpt-5.3-codex");
    expect(html).toContain("gpt-5.3-codex");
    expect(html).toContain("high");
  });

  test("renders the catalog model name while preserving the runtime model id", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-claude-footer",
          role: "assistant",
          content: "Implemented the requested changes.",
          timestamp: "2026-02-22T10:23:15.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
            providerId: "claude",
            modelId: "sonnet",
            variant: "high",
          },
        },
        modelCatalog: {
          models: [
            {
              id: "sonnet",
              providerId: "claude",
              providerName: "Claude",
              modelId: "sonnet",
              modelName: "GPT-5.6-TERRA",
              variants: ["high"],
            },
          ],
          defaultModelsByProvider: {
            claude: "sonnet",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("claude/GPT-5.6-TERRA");
    expect(html).not.toContain("claude/sonnet");
  });

  test("renders no-profile Codex assistant footer with the Codex session accent", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-codex-footer",
          role: "assistant",
          content: "Implemented the requested changes.",
          timestamp: "2026-02-22T10:23:30.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
            providerId: "codex",
            modelId: "gpt-5.4-mini",
            variant: "high",
          },
        },
        ...createCodexMessageCardTestProps(),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("codex/gpt-5.4-mini");
    expect(html).toContain("background-color:var(--odt-runtime-accent-codex)");
  });

  test("hides assistant header and left border in final assistant messages", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-2",
          role: "assistant",
          content: "Ready for implementation.",
          timestamp: "2026-02-22T10:24:00.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            profileId: "planner-main",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("tracking-wide");
    expect(html).not.toContain("border-l-2");
  });

  test("renders assistant footer color from message agent metadata", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-3",
          role: "assistant",
          content: "Implemented with the actual agent.",
          timestamp: "2026-02-22T10:24:30.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
            profileId: "Hephaestus (Deep Agent)",
            modelId: "gpt-5.3-codex",
          },
        },
        sessionAgentColors: {
          "Hephaestus (Deep Agent)": "#2f6fed",
          "Ares (Legacy Agent)": "#f97316",
        },
      }),
    );

    expect(html).toContain("background-color:#2f6fed");
    expect(html).not.toContain("background-color:#f97316");
  });

  test("renders a hover-only copy button for completed assistant rows", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-copyable",
          role: "assistant",
          content: "# Summary\n\nImplemented the requested changes.",
          timestamp: "2026-02-22T10:24:45.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("copy-assistant-message-content");
    expect(html).toContain("group/message");
    expect(html).toContain("group-hover/message:opacity-100");
  });

  test("renders a hover-only copy button for completed intermediate assistant rows", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-intermediate-copyable",
          role: "assistant",
          content: "Intermediate progress update.",
          timestamp: "2026-02-22T10:24:47.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: false,
          },
        },
        isStreamingAssistantMessage: false,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("copy-assistant-message-content");
    expect(html).toContain("group-hover/message:opacity-100");
  });

  test("does not render a copy button for streaming assistant rows", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-streaming",
          role: "assistant",
          content: "Still writing the answer",
          timestamp: "2026-02-22T10:24:50.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: false,
          },
        },
        isStreamingAssistantMessage: true,
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("copy-assistant-message-content");
  });

  test("renders streaming assistant open code fences through the chat markdown path", async () => {
    const html = await renderMessageCardToHtml(
      createMessageCardElement({
        message: {
          id: "assistant-streaming-open-fence",
          role: "assistant",
          content: "Working through this:\n\n```ts\nconst value = 1;",
          timestamp: "2026-02-22T10:24:52.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: false,
          },
        },
        isStreamingAssistantMessage: true,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("markdown-body");
    expect(html).toContain("const value = 1;");
    expect(html).not.toContain("copy-assistant-message-content");
  });

  test("does not render a copy button for whitespace-only assistant rows", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-empty",
          role: "assistant",
          content: "   \n\t  ",
          timestamp: "2026-02-22T10:24:55.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("copy-assistant-message-content");
  });

  test("does not render a copy button for reasoning rows", async () => {
    const html = await renderMessageCardToHtml(
      createMessageCardElement({
        message: {
          id: "thinking-no-copy",
          role: "thinking",
          content: "Inspect the **diff** before applying.",
          timestamp: "2026-02-22T10:25:00.000Z",
          meta: {
            kind: "reasoning",
            partId: "part-thinking-no-copy",
            completed: true,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("copy-assistant-message-content");
  });

  test("renders user messages with border color from send-time user agent metadata", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-1",
          role: "user",
          content: "Draft the final UI pass.",
          timestamp: "2026-02-22T10:25:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            profileId: "Hephaestus (Deep Agent)",
          },
        },
        sessionAgentColors: {
          "Hephaestus (Deep Agent)": "#2f6fed",
          "Ares (Legacy Agent)": "#f97316",
        },
      }),
    );

    expect(html).toContain("rounded-none");
    expect(html).toContain("w-full");
    expect(html).toContain("border-l-4");
    expect(html).toContain("border-left-color:#2f6fed");
  });

  test("wraps long unbroken user prose", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-long-token",
          role: "user",
          content: LONG_TRANSCRIPT_SAMPLE,
          timestamp: "2026-02-22T10:25:30.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words leading-6");
  });

  test("wraps long unbroken assistant plain prose", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "assistant-long-token",
          role: "assistant",
          content: LONG_TRANSCRIPT_SAMPLE,
          timestamp: "2026-02-22T10:25:45.000Z",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words leading-6");
  });

  test("does not color legacy user messages without send-time metadata", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-2",
          role: "user",
          content: "Use the fallback color.",
          timestamp: "2026-02-22T10:26:00.000Z",
        },
        sessionAgentColors: {
          "Ares (Legacy Agent)": "#f97316",
        },
      }),
    );

    expect(html).not.toContain("border-left-color:#f97316");
  });

  test("renders no-profile Codex user messages with the Codex session accent", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-codex",
          role: "user",
          content: "Use the Codex accent.",
          timestamp: "2026-02-22T10:26:30.000Z",
          meta: {
            kind: "user",
            state: "read",
            providerId: "openai",
            modelId: "gpt-5.3-codex",
          },
        },
        ...createCodexMessageCardTestProps(),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-l-4");
    expect(html).toContain("border-left-color:var(--odt-runtime-accent-codex)");
  });

  test("renders queued user messages with pending styling and label", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-queued",
          role: "user",
          content: "Queued follow-up",
          timestamp: "2026-02-22T10:27:00.000Z",
          meta: {
            kind: "user",
            state: "queued",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-pending-border");
    expect(html).toContain("border-l-4");
    expect(html).toContain("bg-card");
    expect(html).toContain("Queued");
  });

  test("renders user file references as inline chips inside the user message text", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-file-ref",
          role: "user",
          content: "check @src/main.ts please",
          timestamp: "2026-02-22T10:28:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
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
                  end: 18,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("check ");
    expect(html).toContain('title="src/main.ts"');
    expect(html).toContain(">main.ts<");
    expect(html).toContain("bg-sky-200");
    expect(html).toContain("lucide-file-code-corner");
    expect(html).toContain("please");
    expect(html).not.toContain("flex min-w-0 flex-1 flex-wrap justify-start gap-2");
  });

  test("renders user skill references as inline chips inside the user message text", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-skill-ref",
          role: "user",
          content: "use $review please",
          timestamp: "2026-02-22T10:28:30.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "use $review please",
              },
              {
                kind: "skill_mention",
                skill: {
                  id: "/skills/review/SKILL.md",
                  path: "/skills/review/SKILL.md",
                  name: "review",
                  title: "Review",
                },
                sourceText: {
                  value: "$review",
                  start: 4,
                  end: 11,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("use ");
    expect(html).toContain(">review<");
    expect(html).not.toContain(">$review<");
    expect(html).toContain("bg-purple-100");
    expect(html).toContain("mx-1");
    expect(html).toContain("lucide-blocks");
    expect(html).toContain("please");
  });

  test("renders user subagent references as inline chips inside the user message text", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-subagent-ref",
          role: "user",
          content: "ask @reviewer please",
          timestamp: "2026-02-22T10:28:40.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "ask @reviewer please",
              },
              {
                kind: "subagent_reference",
                subagent: {
                  id: "reviewer",
                  name: "reviewer",
                  label: "Reviewer",
                },
                sourceText: {
                  value: "@reviewer",
                  start: 4,
                  end: 13,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("ask ");
    expect(html).toContain(">reviewer<");
    expect(html).not.toContain(">@reviewer<");
    expect(html).toContain("bg-teal-100");
    expect(html).toContain("lucide-bot");
    expect(html).toContain("please");
  });

  test("renders ordered user skill reference parts at their transcript position", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "ordered-user-skill-ref",
          role: "user",
          content: "Tell me the purpose of $create-pr please",
          timestamp: "2026-02-22T10:28:45.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "Tell me the purpose of ",
              },
              {
                kind: "skill_mention",
                skill: {
                  id: "/skills/create-pr/SKILL.md",
                  path: "/skills/create-pr/SKILL.md",
                  name: "create-pr",
                  title: "Create PR",
                },
              },
              {
                kind: "text",
                text: " please",
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    const leadingTextIndex = html.indexOf("Tell me the purpose of");
    const chipTextIndex = html.indexOf(">create-pr<");
    const trailingTextIndex = html.indexOf(" please");

    expect(leadingTextIndex).toBeGreaterThanOrEqual(0);
    expect(chipTextIndex).toBeGreaterThan(leadingTextIndex);
    expect(trailingTextIndex).toBeGreaterThan(chipTextIndex);
    expect(html).not.toContain("Tell me the purpose of please");
    expect(html).not.toContain(">$create-pr<");
    expect(html).toContain("mx-1");
  });

  test("renders ordered user subagent reference parts at their transcript position", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "ordered-user-subagent-ref",
          role: "user",
          content: "Ask reviewer to inspect this",
          timestamp: "2026-02-22T10:28:47.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "Ask ",
              },
              {
                kind: "subagent_reference",
                subagent: {
                  id: "reviewer",
                  name: "reviewer",
                  label: "Reviewer",
                },
              },
              {
                kind: "text",
                text: " to inspect this",
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    const leadingTextIndex = html.indexOf("Ask ");
    const chipTextIndex = html.indexOf(">reviewer<");
    const trailingTextIndex = html.indexOf(" to inspect this");

    expect(leadingTextIndex).toBeGreaterThanOrEqual(0);
    expect(chipTextIndex).toBeGreaterThan(leadingTextIndex);
    expect(trailingTextIndex).toBeGreaterThan(chipTextIndex);
    expect(html).toContain("lucide-bot");
    expect(html).not.toContain("Ask  to inspect this");
  });

  test("renders history-loaded skill source text against the raw message content", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "history-loaded-user-skill-ref",
          role: "user",
          content: "Tell me the purpose of $create-pr please skill-history-load-smoke",
          timestamp: "2026-02-22T10:28:50.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "Tell me the purpose of ",
              },
              {
                kind: "skill_mention",
                skill: {
                  id: "/skills/create-pr/SKILL.md",
                  path: "/skills/create-pr/SKILL.md",
                  name: "create-pr",
                  title: "Create PR",
                },
                sourceText: {
                  value: "$create-pr",
                  start: 23,
                  end: 33,
                },
              },
              {
                kind: "text",
                text: " please skill-history-load-smoke",
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    const leadingTextIndex = html.indexOf("Tell me the purpose of");
    const chipTextIndex = html.indexOf(">create-pr<");
    const trailingTextIndex = html.indexOf(" please skill-history-load-smoke");

    expect(leadingTextIndex).toBeGreaterThanOrEqual(0);
    expect(chipTextIndex).toBeGreaterThan(leadingTextIndex);
    expect(trailingTextIndex).toBeGreaterThan(chipTextIndex);
    expect(html).not.toContain("create-prill-history-load-smoke");
    expect(html).not.toContain(">$create-pr<");
  });

  test("renders a skill chip when the raw user message contains the marker without source text", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "raw-marker-user-skill-ref",
          role: "user",
          content: "$thermo-nuclear-code-quality-review",
          timestamp: "2026-02-22T10:28:52.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "skill_mention",
                skill: {
                  id: "/skills/thermo-nuclear-code-quality-review/SKILL.md",
                  path: "/skills/thermo-nuclear-code-quality-review/SKILL.md",
                  name: "thermo-nuclear-code-quality-review",
                  title: "Thermo Nuclear Code Quality Review",
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(">thermo-nuclear-code-quality-review<");
    expect(html).toContain("lucide-blocks");
    expect(html).not.toContain("$thermo-nuclear-code-quality-review");
  });

  test("renders fallback user skill chips only when the raw marker is absent", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "fallback-user-skill-ref",
          role: "user",
          content: "use a skill",
          timestamp: "2026-02-22T10:28:55.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "skill_mention",
                skill: {
                  id: "/skills/review/SKILL.md",
                  path: "/skills/review/SKILL.md",
                  name: "review",
                  title: "Review",
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("use a skill");
    expect(html).toContain(">review<");
  });

  test("renders fallback user file reference text as an inline chip", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-file-ref-only",
          role: "user",
          content: "check @src/main.ts please",
          timestamp: "2026-02-22T10:29:00.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "file_reference",
                file: {
                  id: "file-2",
                  path: "src/main.ts",
                  name: "main.ts",
                  kind: "code",
                },
                sourceText: {
                  value: "@src/main.ts",
                  start: 6,
                  end: 18,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("check ");
    expect(html).toContain('title="src/main.ts"');
    expect(html).toContain(">main.ts<");
    expect(html).toContain("please");
  });

  test("preserves surrounding whitespace when rendering inline user file references", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-file-ref-whitespace",
          role: "user",
          content: "  check @src/main.ts please  ",
          timestamp: "2026-02-22T10:29:30.000Z",
          meta: {
            kind: "user",
            state: "read",
            parts: [
              {
                kind: "text",
                text: "  check @src/main.ts please  ",
              },
              {
                kind: "file_reference",
                file: {
                  id: "file-3",
                  path: "src/main.ts",
                  name: "main.ts",
                  kind: "code",
                },
                sourceText: {
                  value: "@src/main.ts",
                  start: 8,
                  end: 20,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("  check ");
    expect(html).toContain(">main.ts<");
    expect(html).toContain(" please  ");
  });

  test("keeps the user footer row for queued metadata without rendering a separate file chip strip", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-file-ref-queued",
          role: "user",
          content: "check @src/main.ts please",
          timestamp: "2026-02-22T10:30:00.000Z",
          meta: {
            kind: "user",
            state: "queued",
            parts: [
              {
                kind: "text",
                text: "check @src/main.ts please",
              },
              {
                kind: "file_reference",
                file: {
                  id: "file-queued",
                  path: "src/main.ts",
                  name: "main.ts",
                  kind: "code",
                },
                sourceText: {
                  value: "@src/main.ts",
                  start: 6,
                  end: 18,
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Queued");
    expect(html).toContain("mt-2 flex items-end justify-between gap-3");
    expect(html).toContain("flex shrink-0 items-center justify-end gap-2 self-end");
    expect(html).not.toContain("flex min-w-0 flex-wrap items-center gap-2");
  });

  test("renders attachment chips in the user footer row alongside queued metadata", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "user-attachment-queued",
          role: "user",
          content: "please review this screenshot",
          timestamp: "2026-02-22T10:31:00.000Z",
          meta: {
            kind: "user",
            state: "queued",
            parts: [
              {
                kind: "text",
                text: "please review this screenshot",
              },
              {
                kind: "attachment",
                attachment: {
                  id: "attachment-1",
                  path: "/tmp/screenshot.png",
                  name: "screenshot.png",
                  kind: "image",
                  mime: "image/png",
                },
              },
            ],
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Queued");
    expect(html).toContain("screenshot.png");
    expect(html).toContain("mt-2 flex items-end justify-between gap-3");
    expect(html).toContain("flex min-w-0 flex-wrap items-center gap-2");
    expect(html).toContain("flex shrink-0 items-center justify-end gap-2 self-end");
  });
});
