import { describe, expect, test } from "bun:test";
import type { AgentToolData, RuntimeKind } from "@openducktor/contracts";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createDefaultTestChatSettings,
  createMessageCardElement,
  LONG_TRANSCRIPT_SAMPLE,
} from "./agent-chat-message-card-test-harness";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import { formatTime } from "@openducktor/frontend-core/sessions/messages/message-formatting";

const TAB_ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";

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
      }),
    );

    expect(html).not.toContain(formatTime(timestamp));
  });

  test("renders a browser tool call as a browser action card with its typed text", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "browser-tool",
          role: "tool",
          content: "Tool openducktor_odt_browser_type completed",
          timestamp: "2026-07-10T20:33:19.261Z",
          meta: {
            kind: "tool",
            partId: "browser-tool-part",
            callId: "browser-tool-call",
            tool: "openducktor_odt_browser_type",
            toolType: "workflow",
            status: "completed",
            input: { tabId: TAB_ID, ref: "e29", text: "lego fusée", submit: true },
            output: "Typed into e29 and pressed Enter.",
          },
        },
      }),
    );

    expect(html).toContain(">Browser<");
    expect(html).toContain("Type &quot;lego fusée&quot; and press Enter");
    expect(html).not.toContain("browser_type");
    expect(html).toContain("lucide-globe");
    expect(html).not.toContain("Screenshot");
  });

  test("offers the screenshot of a browser screenshot call", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "browser-screenshot",
          role: "tool",
          content: "Tool openducktor_odt_browser_screenshot completed",
          timestamp: "2026-07-10T20:33:19.261Z",
          meta: {
            kind: "tool",
            partId: "browser-screenshot-part",
            callId: "browser-screenshot-call",
            tool: "openducktor_odt_browser_screenshot",
            toolType: "workflow",
            status: "completed",
            input: { tabId: TAB_ID },
            output: "Screenshot of the visible page. Saved to file:///tmp/shot.png.",
          },
        },
      }),
    );

    expect(html).toContain("Screenshot page");
    expect(html).toContain("Screenshot</button>");
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
      }),
    );

    expect(html).toContain(formatTime(timestamp));
  });

  test("shows failed, stopped, and unknown background outcomes on tool cards", () => {
    const renderCard = (
      toolType: "bash" | "workflow",
      outcome: "failed" | "stopped" | "unknown",
    ): string =>
      renderToStaticMarkup(
        createMessageCardElement({
          message: {
            id: `${toolType}-${outcome}`,
            role: "tool",
            content: `Tool ${toolType} failed`,
            timestamp: "2026-09-24T20:00:00.000Z",
            meta: {
              kind: "tool",
              partId: `${toolType}-${outcome}`,
              callId: `${toolType}-${outcome}`,
              tool: toolType === "bash" ? "Bash" : "openducktor_odt_apply_workflow_event",
              toolType,
              status: "error",
              error:
                outcome === "failed"
                  ? "Server stopped responding"
                  : outcome === "stopped"
                    ? "Stopped: User ended task"
                    : "Claude ended the background task without a terminal outcome.",
              metadata: { backgroundTaskStatus: outcome },
            },
          },
        }),
      );

    expect(renderCard("bash", "failed")).toContain("text-destructive-muted");
    expect(renderCard("bash", "failed")).not.toContain("text-cancelled-muted");
    expect(renderCard("bash", "stopped")).toContain("text-cancelled-muted");
    expect(renderCard("workflow", "failed")).toContain("FAILED");
    expect(renderCard("workflow", "failed")).not.toContain("CANCELLED");
    expect(renderCard("workflow", "stopped")).toContain("CANCELLED");
    expect(renderCard("bash", "unknown")).toContain(
      "Claude ended the background task without a terminal outcome.",
    );
    expect(renderCard("workflow", "unknown")).toContain("FAILED");
    expect(renderCard("workflow", "unknown")).not.toContain("CANCELLED");
  });

  test("shows the error message of a failed ODT read in the error tone of the tool row", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-read-failed",
          role: "tool",
          content: "Tool odt_read_task failed",
          timestamp: "2026-02-22T10:20:37.000Z",
          meta: {
            kind: "tool",
            partId: "part-read-failed",
            callId: "call-read-failed",
            tool: "odt_read_task",
            toolType: "workflow",
            status: "error",
            input: { taskId: "task-x" },
            error: JSON.stringify({
              ok: false,
              error: { code: "ODT_HOST_BRIDGE_ERROR", message: "Task task-x was not found." },
            }),
          },
        },
      }),
    );

    const document = new DOMParser().parseFromString(html, "text/html");
    const line = Array.from(document.querySelectorAll("p")).find(
      (element) => element.textContent === "Task task-x was not found.",
    );
    expect(line?.classList.contains("text-destructive-muted")).toBe(true);
    expect(html).not.toMatch(/<details\b[^>]*\bopen\b/);
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
      }),
    );

    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("fairnest-97f");
  });

  const artifactPreviewCases: Array<{
    tool: string;
    runtimeKind: RuntimeKind;
    status: "pending" | "running" | "completed";
    flags: AgentToolData;
    hints: Pick<ToolMeta, "preview" | "title">;
    expected: string;
  }> = [
    {
      tool: "odt_read_task_artifacts",
      runtimeKind: "codex",
      status: "pending",
      flags: { codes: ["spec", "plan", "qaReport", "login-preview"] },
      hints: { preview: "Old artifact preview", title: "Old artifact title" },
      expected: "task-1 · spec, plan, qaReport, login-preview",
    },
    {
      tool: "openducktor_odt_read_task_artifacts",
      runtimeKind: "opencode",
      status: "running",
      flags: { codes: ["spec", "plan"] },
      hints: { title: "Old artifact title" },
      expected: "task-1 · spec, plan",
    },
    {
      tool: "functions.openducktor_odt_read_task_artifacts",
      runtimeKind: "opencode",
      status: "completed",
      flags: { codes: ["login-preview", "spec"] },
      hints: {},
      expected: "task-1 · login-preview, spec",
    },
    {
      tool: "mcp__openducktor__odt_read_task_artifacts",
      runtimeKind: "claude",
      status: "completed",
      flags: { codes: ["qaReport"] },
      hints: { preview: "Old artifact preview" },
      expected: "task-1 · qaReport",
    },
  ];

  test.each(artifactPreviewCases)(
    "previews requested task artifacts for $tool while $status",
    ({ tool, runtimeKind, status, flags, hints, expected }) => {
      const html = renderToStaticMarkup(
        createMessageCardElement({
          message: {
            id: "tool-read-artifact",
            role: "tool",
            content: `Tool ${tool} ${status}`,
            timestamp: "2026-02-22T10:20:30.000Z",
            meta: {
              kind: "tool",
              partId: "part-read-artifact",
              callId: "call-read-artifact",
              tool,
              displayLabel: tool,
              toolType: "generic",
              status,
              inputStreaming: false,
              input: { taskId: "task-1", ...flags },
              ...hints,
              output: '{"artifacts":[{"code":"login-preview","body":"Returned artifact body"}]}',
            },
          },
          sessionIdentity: null,
          runtimePresentation: resolveAgentChatRuntimePresentation({
            runtimeDefinitions: [],
            runtimeKind,
          }),
        }),
      );
      const summary = new DOMParser().parseFromString(html, "text/html").querySelector("summary");
      expect(summary?.querySelector("p")?.textContent).toBe("read_task_artifacts");
      expect(summary?.textContent).toContain(expected);
      expect(summary?.textContent).not.toContain("Old artifact");
      expect(summary?.textContent).not.toContain("Returned artifact body");
      expect(html.includes('aria-label="Running tool"')).toBe(status === "running");
      expect(html).toContain("Output");
      expect(html).not.toContain("Returned artifact body");
    },
  );

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
    input: AgentToolData;
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
            odtTool: null,
          }),
          supportedApprovalReplyOutcomes: null,
        },
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
        sessionIdentity: null,
      }),
    );

    const summary = new DOMParser().parseFromString(html, "text/html").querySelector("summary");
    expect(Array.from(summary?.querySelectorAll("p") ?? [], (el) => el.textContent)).toEqual([
      "read",
      "/repo/src/app.ts",
    ]);
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
      }),
    );

    expect(html).toContain("apps/web/src/contexts/AuthContext.tsx");
    expect(html).not.toContain("/repo/apps/web/src/contexts/AuthContext.tsx");
  });

  test("shows the written-file expand control and its Input and Output boxes", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "tool-write-without-diff",
          role: "tool",
          content: "Tool write completed",
          timestamp: "2026-02-22T10:20:36.000Z",
          meta: {
            kind: "tool",
            partId: "part-write",
            callId: "call-write",
            tool: "write",
            toolType: "file_edit",
            status: "completed",
            input: { path: "src/example.ts", content: "Requested file content" },
            output: "Created file successfully: src/example.ts",
            fileContent: [
              { file: "src/example.ts", content: "Requested file content", type: "modified" },
            ],
          },
        },
        chatSettings: {
          ...createDefaultTestChatSettings(),
          expandFileDiffsByDefault: false,
        },
      }),
    );

    expect(html).not.toContain(
      "File diff unavailable. The runtime did not return the applied changes.",
    );
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain(">Input</summary>");
    expect(html).toContain(">Output</summary>");
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

  test.each([true, false, undefined])(
    "distinguishes pending tool activity without visible status text for inputStreaming: %s",
    (inputStreaming) => {
      const meta: ToolMeta = {
        kind: "tool",
        partId: "part-execute-queued",
        callId: "call-execute-queued",
        tool: "execute",
        toolType: "generic",
        status: "pending",
      };
      if (inputStreaming !== undefined) {
        meta.inputStreaming = inputStreaming;
        meta.input = { code: "console.log(42)" };
      }
      const html = renderToStaticMarkup(
        createMessageCardElement({
          message: {
            id: "tool-execute-queued",
            role: "tool",
            content: "Tool execute pending",
            timestamp: "2026-02-22T10:21:10.000Z",
            meta,
          },
        }),
      );
      const document = new DOMParser().parseFromString(html, "text/html");
      const text = document.body.textContent;
      const title = document.querySelector("p");
      expect(title?.textContent).toBe("execute");
      if (inputStreaming !== undefined) {
        expect(title?.parentElement?.classList.contains("opacity-50")).toBe(true);
        expect(html).not.toContain("pending-");
      }
      if (inputStreaming === false) expect(text).toContain("console.log(42)");
      expect(text).not.toContain("Preparing");
      expect(html).not.toContain("border-dashed");
      expect(text).not.toContain("Queued");
      expect(html.includes('aria-label="Preparing tool"')).toBe(inputStreaming !== false);
      expect(html).not.toContain('aria-label="Running tool"');
    },
  );
});
