import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { AgentChatMessageCard } from "./agent-chat-message-card";

const renderToHtml = async (element: ReturnType<typeof createElement>): Promise<string> => {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
};

describe("AgentChatMessageCard tool duration", () => {
  test("uses completedAt - inputReadyAt for workflow duration display", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-1",
          role: "tool",
          content: "Tool openducktor_odt_set_spec completed",
          timestamp: "2026-02-20T19:01:00.000Z",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "openducktor_odt_set_spec",
            status: "completed",
            input: { taskId: "fairnest-abc", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
            inputReadyAtMs: Date.parse("2026-02-20T19:00:30.000Z"),
            observedStartedAtMs: Date.parse("2026-02-20T19:00:00.000Z"),
            observedEndedAtMs: Date.parse("2026-02-20T19:01:00.000Z"),
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("30s");
    expect(html).not.toContain("1.5s");
  });

  test("falls back to part timing when observed timing is absent", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-2",
          role: "tool",
          content: "Tool openducktor_odt_set_spec completed",
          timestamp: "2026-02-20T19:00:02.500Z",
          meta: {
            kind: "tool",
            partId: "part-2",
            callId: "call-2",
            tool: "openducktor_odt_set_spec",
            status: "completed",
            input: { taskId: "fairnest-def", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("1.5s");
  });

  test("renders expandable details for regular read_task tool rows", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-3",
          role: "tool",
          content: "Tool read_task completed",
          timestamp: "2026-02-22T10:20:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-3",
            callId: "call-3",
            tool: "read_task",
            status: "completed",
            input: { taskId: "fairnest-97f" },
            output: '{"task":{"id":"fairnest-97f","title":"Add Facebook login"}}',
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("fairnest-97f");
  });

  test.each([
    {
      id: "tool-todowrite",
      tool: "todowrite",
      content: "Tool todowrite completed",
      timestamp: "2026-02-22T10:20:31.000Z",
      input: { todos: [] },
      output: "ok",
    },
    {
      id: "tool-namespaced-todowrite",
      tool: "openducktor_odt_todowrite",
      content: "Tool openducktor_odt_todowrite completed",
      timestamp: "2026-02-22T10:20:32.000Z",
      input: { todos: [] },
      output: "ok",
    },
    {
      id: "tool-todoread",
      tool: "todoread",
      content: "Tool todoread completed",
      timestamp: "2026-02-22T10:20:33.000Z",
      input: {},
      output: "[]",
    },
    {
      id: "tool-namespaced-todoread",
      tool: "openducktor_odt_todoread",
      content: "Tool openducktor_odt_todoread completed",
      timestamp: "2026-02-22T10:20:34.000Z",
      input: {},
      output: "[]",
    },
  ])("renders ListTodo icon for $tool tool rows", ({
    id,
    tool,
    content,
    timestamp,
    input,
    output,
  }) => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id,
          role: "tool",
          content,
          timestamp,
          meta: {
            kind: "tool",
            partId: `part-${id}`,
            callId: `call-${id}`,
            tool,
            status: "completed",
            input,
            output,
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("lucide-list-todo");
  });

  test("renders file tool summaries relative to the session working directory", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-relative-path",
          role: "tool",
          content: "Tool read completed",
          timestamp: "2026-02-22T10:20:35.000Z",
          meta: {
            kind: "tool",
            partId: "part-relative-path",
            callId: "call-relative-path",
            tool: "read",
            status: "completed",
            preview: "/repo/apps/web/src/contexts/AuthContext.tsx",
            input: { path: "/repo/apps/web/src/contexts/AuthContext.tsx" },
            output: "file contents",
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
        sessionWorkingDirectory: "/repo",
      }),
    );

    expect(html).toContain("apps/web/src/contexts/AuthContext.tsx");
    expect(html).not.toContain("/repo/apps/web/src/contexts/AuthContext.tsx");
  });

  test("renders one file edit card per file in a multi-file apply_patch result without a summary description", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-multi-file-apply-patch",
          role: "tool",
          content: "Tool apply_patch completed",
          timestamp: "2026-02-22T10:20:36.000Z",
          meta: {
            kind: "tool",
            partId: "part-multi-file-apply-patch",
            callId: "call-multi-file-apply-patch",
            tool: "apply_patch",
            status: "completed",
            input: {
              patch:
                "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
                "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
            },
            output: "Updated 2 files",
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    const fileEditCardMatches = html.match(/data-testid="agent-chat-file-edit-card"/g) ?? [];

    expect(fileEditCardMatches).toHaveLength(2);
    expect(html).not.toContain("2 files modified");
    expect(html).toContain("src/");
    expect(html).toContain("first.ts");
    expect(html).toContain("second.ts");
    expect(html).toContain("+1");
    expect(html).toContain("+2");
  });

  test("renders workflow tool executing state with blue styling and running label", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-4",
          role: "tool",
          content: "Tool openducktor_odt_build_completed running",
          timestamp: "2026-02-22T10:21:00.000Z",
          meta: {
            kind: "tool",
            partId: "part-4",
            callId: "call-4",
            tool: "openducktor_odt_build_completed",
            status: "pending",
            input: { taskId: "fairnest-98a" },
            output: "",
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("animate-spin");
    expect(html).toContain("border-info-border");
    expect(html).not.toContain("border-pending-border");
    expect(html).toContain("RUNNING");
    expect(html).toContain("build_completed");
  });

  test("renders queued workflow tools with purple styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-queued",
          role: "tool",
          content: "Tool openducktor_odt_set_plan pending",
          timestamp: "2026-02-22T10:21:10.000Z",
          meta: {
            kind: "tool",
            partId: "part-queued",
            callId: "call-queued",
            tool: "openducktor_odt_set_plan",
            status: "pending",
            input: {},
            output: "",
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("animate-spin");
    expect(html).toContain("border-pending-border");
    expect(html).not.toContain("border-info-border");
    expect(html).toContain("QUEUED");
    expect(html).not.toContain("RUNNING");
  });

  test("renders workflow MCP validation failures as error styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-5",
          role: "tool",
          content: "Tool odt_set_plan completed",
          timestamp: "2026-02-22T10:21:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-5",
            callId: "call-5",
            tool: "odt_set_plan",
            status: "error",
            input: { taskId: "fairnest-99z" },
            error: "Input validation error",
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
  });

  test("renders workflow status-guard rejections as error styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-guard",
          role: "tool",
          content: "Tool odt_set_spec completed",
          timestamp: "2026-02-22T10:21:35.000Z",
          meta: {
            kind: "tool",
            partId: "part-guard",
            callId: "call-guard",
            tool: "odt_set_spec",
            status: "error",
            input: { taskId: "fairnest-99z" },
            error:
              "set_spec is only allowed from open/spec_ready/ready_for_dev (current: in_progress)",
          },
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
  });

  test("renders cancelled workflow tools with orange styling", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "tool-cancelled",
          role: "tool",
          content: "Tool odt_set_plan failed",
          timestamp: "2026-02-22T10:21:40.000Z",
          meta: {
            kind: "tool",
            partId: "part-cancelled",
            callId: "call-cancelled",
            tool: "odt_set_plan",
            status: "error",
            input: { taskId: "fairnest-cancelled" },
            error: "Request cancelled by user",
            output: "",
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-cancelled-border");
    expect(html).not.toContain("border-destructive-border");
  });

  test("renders user-stopped session notices as cancelled cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "session-notice-stopped",
          role: "system",
          content: "Session stopped at your request.",
          timestamp: "2026-02-22T10:21:45.000Z",
          meta: {
            kind: "session_notice",
            tone: "cancelled",
            reason: "user_stopped",
            title: "Stopped",
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-cancelled-border");
    expect(html).toContain("bg-cancelled-surface");
    expect(html).toContain("Session stopped at your request.");
    expect(html).toContain("Stopped");
    expect(html).not.toContain("border-destructive-border");
    expect(html).not.toContain(">System<");
  });

  test("renders system prompt as expandable card", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "sys-1",
          role: "system",
          content: "System prompt:\n\nAlways validate tool inputs before execution.",
          timestamp: "2026-02-22T10:22:00.000Z",
        },
        sessionRole: "spec",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Show system prompt");
    expect(html).toContain("Always validate tool inputs");
  });

  test("renders reasoning rows as inline thinking transcript text without disclosure chrome", async () => {
    const html = await renderToHtml(
      createElement(AgentChatMessageCard, {
        message: {
          id: "thinking-1",
          role: "thinking",
          content: "Inspect the **diff** before applying.\n\n- Keep markdown output",
          timestamp: "2026-02-22T10:22:15.000Z",
          meta: {
            kind: "reasoning",
            partId: "part-thinking-1",
            completed: true,
          },
        },
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Thinking:");
    expect(html).toContain("space-y-0.5");
    expect(html).not.toContain("items-baseline");
    expect(html).toContain("markdown-body");
    expect(html).toMatch(/(<strong>diff<\/strong>|\*\*diff\*\*)/);
    expect(html).toContain("diff");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("cursor-pointer");
    expect(html).not.toContain("lucide-brain");
    expect(html).not.toContain("10:22:15");
    expect(html).not.toContain("tracking-wide");
  });

  test("renders assistant footer with agent, provider/model, and variant labels", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("planner-main");
    expect(html).toContain("openai/gpt-5.3-codex");
    expect(html).toContain("gpt-5.3-codex");
    expect(html).toContain("high");
  });

  test("hides assistant header and left border in final assistant messages", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("tracking-wide");
    expect(html).not.toContain("border-l-2");
  });

  test("renders assistant footer color from message agent metadata instead of session selection", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "planner",
        sessionSelectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          profileId: "Ares (Legacy Agent)",
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

  test("renders user messages with border color from send-time user agent metadata", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          profileId: "Ares (Legacy Agent)",
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

  test("does not color legacy user messages from the current session selection", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "user-2",
          role: "user",
          content: "Use the fallback color.",
          timestamp: "2026-02-22T10:26:00.000Z",
        },
        sessionRole: "build",
        sessionSelectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          profileId: "Ares (Legacy Agent)",
        },
        sessionAgentColors: {
          "Ares (Legacy Agent)": "#f97316",
        },
      }),
    );

    expect(html).not.toContain("border-left-color:#f97316");
  });

  test("renders queued user messages with pending styling and label", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: null,
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
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
        sessionWorkingDirectory: "/repo",
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

  test("renders fallback user file reference text as an inline chip", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
        sessionWorkingDirectory: "/repo",
      }),
    );

    expect(html).toContain("check ");
    expect(html).toContain('title="src/main.ts"');
    expect(html).toContain(">main.ts<");
    expect(html).toContain("please");
  });

  test("preserves surrounding whitespace when rendering inline user file references", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
        sessionWorkingDirectory: "/repo",
      }),
    );

    expect(html).toContain("  check ");
    expect(html).toContain(">main.ts<");
    expect(html).toContain(" please  ");
  });

  test("keeps the user footer row for queued metadata without rendering a separate file chip strip", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionRole: "build",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Queued");
    expect(html).toContain("mt-2 flex items-end justify-end gap-2");
    expect(html).toContain("flex shrink-0 items-center justify-end gap-2 self-end");
    expect(html).not.toContain("flex min-w-0 flex-1 flex-wrap justify-start gap-2");
  });
});
