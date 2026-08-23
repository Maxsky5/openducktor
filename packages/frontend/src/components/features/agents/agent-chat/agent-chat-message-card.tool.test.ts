import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createDefaultTestChatSettings,
  createMessageCardElement,
  LONG_TRANSCRIPT_SAMPLE,
} from "./agent-chat-message-card-test-harness";
import { formatTime } from "./message-formatting";

describe("AgentChatMessageCard tool presentation", () => {
  test("hides approximate hydrated tool timestamps", () => {
    const timestamp = "2026-07-10T20:33:01.000Z";
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "hydrated-tool",
          role: "tool",
          content: "Tool search completed",
          timestamp,
          timestampIsApproximate: true,
          meta: {
            kind: "tool",
            partId: "hydrated-tool-part",
            callId: "hydrated-tool-call",
            tool: "search",
            toolType: "search",
            status: "completed",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain(formatTime(timestamp));
  });

  test("keeps exact tool timestamps visible", () => {
    const timestamp = "2026-07-10T20:33:19.261Z";
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "exact-tool",
          role: "tool",
          content: "Tool search completed",
          timestamp,
          meta: {
            kind: "tool",
            partId: "exact-tool-part",
            callId: "exact-tool-call",
            tool: "search",
            toolType: "search",
            status: "completed",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(formatTime(timestamp));
  });

  test("uses runtime part timing for workflow duration display", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
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
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("1.5s");
    expect(html).not.toContain("30s");
  });

  test("falls back to part timing when observed timing is absent", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
            status: "completed",
            input: { taskId: "fairnest-def", markdown: "# Spec" },
            output: "ok",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("1.5s");
  });

  test("renders failed workflow tool pill aligned cleanly without centered ml-auto", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-failed",
          role: "tool",
          content: "Tool openducktor_odt_set_pull_request failed",
          timestamp: "2026-02-20T19:00:02.500Z",
          meta: {
            kind: "tool",
            partId: "part-failed",
            callId: "call-failed",
            tool: "openducktor_odt_set_pull_request",
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-def" },
            error: "Branch conflict",
            startedAtMs: 1_000,
            endedAtMs: 2_500,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("FAILED");
    expect(html).not.toContain("ml-auto rounded-full");
    expect(html).toContain("rounded-full border");
    expect(html).toContain("1.5s");
    expect(html).toMatch(/<details\b[^>]*\bopen\b/);
    expect(html).not.toContain(">Activity<");
  });

  test("auto-opens failed ODT workflow tool error details", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-wf-failed",
          role: "tool",
          content: "Tool openducktor_odt_set_spec failed",
          timestamp: "2026-02-22T10:20:36.000Z",
          meta: {
            kind: "tool",
            partId: "part-wf-failed",
            callId: "call-wf-failed",
            tool: "openducktor_odt_set_spec",
            toolType: "workflow",
            status: "error",
            input: { taskId: "task-x" },
            error: "Task already has a spec",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toMatch(/<details\b[^>]*\bopen\b/);
    expect(html).toContain("Task already has a spec");
  });

  test("keeps regular failed tool errors collapsed", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-regular-failed",
          role: "tool",
          content: "Tool bash failed",
          timestamp: "2026-02-22T10:20:37.000Z",
          meta: {
            kind: "tool",
            partId: "part-regular-failed",
            callId: "call-regular-failed",
            tool: "bash",
            toolType: "bash",
            status: "error",
            input: { command: "invalid-cmd" },
            error: "command not found",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toMatch(/<details\b[^>]*\bopen\b/);
    expect(html).toContain("command not found");
  });

  test("renders expandable details for regular read_task tool rows", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "generic" as const,
            status: "completed",
            input: { taskId: "fairnest-97f" },
            output: '{"task":{"id":"fairnest-97f","title":"Add Facebook login"}}',
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("fairnest-97f");
  });

  test("wraps long unbroken question tool prompts", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-question-long-prompt",
          role: "tool",
          content: "Tool question completed",
          timestamp: "2026-02-22T10:20:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-question-long-prompt",
            callId: "call-question-long-prompt",
            tool: "ask_question",
            toolType: "question",
            status: "completed",
            input: { questions: [{ prompt: LONG_TRANSCRIPT_SAMPLE }] },
            output: '{"answers":[["yes"]]}',
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Questions and answers");
    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("break-words font-medium text-foreground");
  });

  test("wraps long unbroken question tool answers", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-question-long-answer",
          role: "tool",
          content: "Tool question completed",
          timestamp: "2026-02-22T10:20:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-question-long-answer",
            callId: "call-question-long-answer",
            tool: "ask_question",
            toolType: "question",
            status: "completed",
            input: { questions: [{ prompt: "Confirm deployment?" }] },
            output: JSON.stringify({ answers: [[LONG_TRANSCRIPT_SAMPLE]] }),
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Questions and answers");
    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words text-foreground");
  });

  type ToolRow = {
    id: string;
    tool: string;
    content: string;
    timestamp: string;
    input: Record<string, unknown>;
    output: string;
  };
  const toolRows: ToolRow[] = [
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
  ];

  test.each(toolRows)(
    "renders ListTodo icon for $tool tool rows",
    ({ id, tool, content, timestamp, input, output }) => {
      const html = renderToStaticMarkup(
        createMessageCardElement({
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
              toolType: "todo",
              status: "completed",
              input,
              output,
            },
          },
          sessionAgentColors: {},
        }),
      );

      expect(html).toContain("lucide-list-todo");
    },
  );

  test("uses the adapter-provided display label as the visible tool label", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-codex-todo",
          role: "tool",
          content: "Tool update_plan completed",
          timestamp: "2026-02-22T10:20:35.000Z",
          meta: {
            kind: "tool",
            partId: "part-codex-todo",
            callId: "call-codex-todo",
            tool: "update_plan",
            toolType: "todo",
            title: "update_plan",
            displayLabel: "todo",
            status: "completed",
            input: { todos: [] },
            output: "Plan updated",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(">todo<");
    expect(html).not.toContain(">update_plan<");
  });

  test("renders caller-classified workflow tools without ODT metadata", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "custom-workflow-tool",
          role: "tool",
          content: "Tool deploy running",
          timestamp: "2026-02-20T19:00:02.500Z",
          meta: {
            kind: "tool",
            partId: "custom-workflow-part",
            callId: "custom-workflow-call",
            tool: "deploy",
            toolType: "generic",
            status: "running",
          },
        },
        runtimePresentation: {
          runtimeKind: null,
          presentToolCall: () => ({
            kind: "workflow",
            displayName: "Deploy release",
          }),
          supportedApprovalReplyOutcomes: null,
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Deploy release");
    expect(html).toContain("RUNNING");
  });

  test("does not use tool title as the visible tool label", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-read-path-title",
          role: "tool",
          content: "Tool read completed",
          timestamp: "2026-02-22T10:20:35.000Z",
          meta: {
            kind: "tool",
            partId: "part-read-path-title",
            callId: "call-read-path-title",
            tool: "read",
            toolType: "read",
            title: "/repo/src/app.ts",
            status: "completed",
            input: { path: "/repo/src/app.ts" },
            output: "contents",
          },
        },
        sessionAgentColors: {},
        sessionIdentity: null,
      }),
    );

    expect(html).toContain('<p class="shrink-0 font-medium text-current">read</p>');
    expect(html).not.toContain('<p class="shrink-0 font-medium text-current">/repo/src/app.ts</p>');
    expect(html).toContain('<p class="truncate text-muted-foreground">/repo/src/app.ts</p>');
  });
  test("renders file tool summaries relative to the session working directory", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "read",
            status: "completed",
            preview: "/repo/apps/web/src/contexts/AuthContext.tsx",
            input: { path: "/repo/apps/web/src/contexts/AuthContext.tsx" },
            output: "file contents",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("apps/web/src/contexts/AuthContext.tsx");
    expect(html).not.toContain("/repo/apps/web/src/contexts/AuthContext.tsx");
  });

  test("renders one file edit card per file in a multi-file apply_patch result without a summary description", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "file_edit",
            status: "completed",
            fileDiffs: [
              {
                file: "src/first.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
              {
                file: "src/second.ts",
                type: "modified",
                additions: 2,
                deletions: 1,
                diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
              },
            ],
            output: "Updated 2 files",
          },
        },
        sessionAgentColors: {},
        chatSettings: {
          ...createDefaultTestChatSettings(),
          expandFileDiffsByDefault: false,
        },
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
      createMessageCardElement({
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
            toolType: "workflow",
            status: "pending",
            input: { taskId: "fairnest-98a" },
            output: "",
          },
        },
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
      createMessageCardElement({
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
            toolType: "workflow",
            status: "pending",
            input: {},
            output: "",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("animate-spin");
    expect(html).toContain("border-pending-border");
    expect(html).not.toContain("border-info-border");
    expect(html).toContain("QUEUED");
    expect(html).not.toContain("RUNNING");
  });

  test("renders workflow MCP validation failures as destructive error details", () => {
    const validationError =
      'MCP error -32602: Input validation error: Invalid arguments for tool odt_set_pull_request: [{"path":["workspaceId"],"message":"Invalid input: expected never, received string"}]';
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-5",
          role: "tool",
          content: "Tool odt_set_pull_request failed",
          timestamp: "2026-02-22T10:21:30.000Z",
          meta: {
            kind: "tool",
            partId: "part-5",
            callId: "call-5",
            tool: "odt_set_pull_request",
            toolType: "workflow",
            status: "error",
            input: {
              taskId: "fairnest-99z",
              workspaceId: "repo",
              providerId: "github",
              number: 12,
            },
            error: validationError,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
    expect(html).not.toContain("border-cancelled-border");
    expect(html).toContain("FAILED");
    expect(html).toContain("odt_set_pull_request");
    expect(html).toContain("workspaceId");
    expect(html).toContain("Input validation error");
  });

  test("renders workflow status-guard rejections as error styling", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-99z" },
            error:
              "set_spec is only allowed from open/spec_ready/ready_for_dev/in_progress/blocked/ai_review/human_review (current: closed)",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).not.toContain("border-success-border");
  });

  test("renders cancelled workflow tools with orange styling", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
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
            toolType: "workflow",
            status: "error",
            input: { taskId: "fairnest-cancelled" },
            error: "Request cancelled by user",
            output: "",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-cancelled-border");
    expect(html).not.toContain("border-destructive-border");
  });
});
