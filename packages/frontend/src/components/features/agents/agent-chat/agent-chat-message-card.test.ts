import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { type ComponentProps, createElement as createReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import { buildMessage } from "./agent-chat-test-fixtures";
import {
  AgentSessionTranscriptDialogContext,
  type AgentSessionTranscriptDialogContextValue,
} from "./agent-session-transcript-dialog-context";
import { formatTime } from "./message-formatting";
import type { ParentSessionRuntimeContext } from "./subagent-session-key";

const TEST_RUNTIME_DEFINITIONS_CONTEXT = {
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
  loadRepoRuntimeCatalog: async () => {
    throw new Error("Test runtime catalog loader was not configured.");
  },
  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
  loadRepoRuntimeSkills: async () => ({ skills: [] }),
  loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
  loadRepoRuntimeFileSearch: async () => [],
} satisfies ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

const DEFAULT_TEST_CHAT_SETTINGS = createChatSettingsFixture();
const DEFAULT_TEST_SESSION_IDENTITY: ParentSessionRuntimeContext = {
  runtimeKind: "opencode",
  workingDirectory: "/repo",
};
const LONG_TRANSCRIPT_TOKEN =
  "supercalifragilisticexpialidocioussupercalifragilisticexpialidocious";

type AgentChatMessageCardTestProps = Omit<
  ComponentProps<typeof AgentChatMessageCard>,
  "sessionIdentity"
> & {
  chatSettings?: typeof DEFAULT_TEST_CHAT_SETTINGS;
  sessionIdentity?: ParentSessionRuntimeContext | null;
  transcriptDialog?: AgentSessionTranscriptDialogContextValue;
};

const createElement = (
  _type: typeof AgentChatMessageCard,
  {
    chatSettings = DEFAULT_TEST_CHAT_SETTINGS,
    transcriptDialog,
    ...props
  }: AgentChatMessageCardTestProps,
) => {
  const card = createReactElement(AgentChatMessageCard, {
    sessionIdentity: DEFAULT_TEST_SESSION_IDENTITY,
    ...props,
  });
  const cardWithTranscriptContext = transcriptDialog
    ? createReactElement(
        AgentSessionTranscriptDialogContext.Provider,
        { value: transcriptDialog },
        card,
      )
    : card;
  return createReactElement(
    RuntimeDefinitionsContext.Provider,
    { value: TEST_RUNTIME_DEFINITIONS_CONTEXT },
    createReactElement(
      AgentChatSettingsProvider,
      { value: chatSettings },
      cardWithTranscriptContext,
    ),
  );
};

const renderToHtml = async (element: ReturnType<typeof createElement>): Promise<string> => {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
};

describe("AgentChatMessageCard tool duration", () => {
  test("hides approximate hydrated tool timestamps", () => {
    const timestamp = "2026-07-10T20:33:01.000Z";
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
            input: { questions: [{ prompt: LONG_TRANSCRIPT_TOKEN }] },
            output: '{"answers":[["yes"]]}',
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Questions and answers");
    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("break-words line-clamp-2 font-medium text-foreground");
  });

  test("wraps long unbroken question tool answers", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
            output: JSON.stringify({ answers: [[LONG_TRANSCRIPT_TOKEN]] }),
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Questions and answers");
    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("whitespace-pre-wrap break-words line-clamp-2 text-foreground");
  });

  test.each([
    {
      id: "tool-todowrite",
      tool: "todowrite",
      toolType: "generic" as const,
      content: "Tool todowrite completed",
      timestamp: "2026-02-22T10:20:31.000Z",
      input: { todos: [] },
      output: "ok",
    },
    {
      id: "tool-namespaced-todowrite",
      tool: "openducktor_odt_todowrite",
      toolType: "generic" as const,
      content: "Tool openducktor_odt_todowrite completed",
      timestamp: "2026-02-22T10:20:32.000Z",
      input: { todos: [] },
      output: "ok",
    },
    {
      id: "tool-todoread",
      tool: "todoread",
      toolType: "generic" as const,
      content: "Tool todoread completed",
      timestamp: "2026-02-22T10:20:33.000Z",
      input: {},
      output: "[]",
    },
    {
      id: "tool-namespaced-todoread",
      tool: "openducktor_odt_todoread",
      toolType: "generic" as const,
      content: "Tool openducktor_odt_todoread completed",
      timestamp: "2026-02-22T10:20:34.000Z",
      input: {},
      output: "[]",
    },
  ])(
    "renders ListTodo icon for $tool tool rows",
    ({ id, tool, content, timestamp, input, output }) => {
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
      createElement(AgentChatMessageCard, {
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
          ...DEFAULT_TEST_CHAT_SETTINGS,
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
      createElement(AgentChatMessageCard, {
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

  test("wraps long unbroken session notice prose", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "session-notice-long-token",
          role: "system",
          content: LONG_TRANSCRIPT_TOKEN,
          timestamp: "2026-02-22T10:21:46.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Notice",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("whitespace-pre-wrap break-words line-clamp-2 leading-6 text-inherit");
  });

  test("renders session error notices as destructive cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "session-notice-error",
          role: "system",
          content: "Our servers are currently overloaded. Please try again later.",
          timestamp: "2026-02-22T10:21:50.000Z",
          meta: {
            kind: "session_notice",
            tone: "error",
            reason: "session_error",
            title: "Error",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).toContain("bg-destructive-surface");
    expect(html).toContain("Our servers are currently overloaded. Please try again later.");
    expect(html).toContain("Error");
    expect(html).not.toContain("border-cancelled-border");
    expect(html).not.toContain(">System<");
  });

  test("renders session compaction notices as informational cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "session-notice-compacted",
          role: "system",
          content: "Session compacted.",
          timestamp: "2026-05-18T21:01:00.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Compacted",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-info-border");
    expect(html).toContain("bg-info-surface");
    expect(html).toContain("text-info-surface-foreground");
    expect(html).toContain("Session compacted.");
    expect(html).toContain("Compacted");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("border-destructive-border");
    expect(html).not.toContain("border-cancelled-border");
    expect(html).not.toContain(">System<");
  });

  test("renders running session compaction notices with a loader", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "session-notice-compacting",
          role: "system",
          content: "Session compaction started.",
          timestamp: "2026-05-18T21:00:30.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Compacting",
            compactionStatus: "running",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-info-border");
    expect(html).toContain("Session compaction started.");
    expect(html).toContain("Compacting");
    expect(html).toContain("animate-spin");
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
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Show system prompt");
    expect(html).toContain("Always validate tool inputs");
  });

  test("wraps long unbroken system prose outside system-prompt cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "system-long-token",
          role: "system",
          content: LONG_TRANSCRIPT_TOKEN,
          timestamp: "2026-02-22T10:22:01.000Z",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain(
      "whitespace-pre-wrap break-words line-clamp-2 leading-6 text-foreground",
    );
  });

  test("renders subagent cards without the shared System header", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-1",
            correlationKey: "part:assistant-task-tool-running:subtask-a",
            status: "completed",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-1",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain(">System<");
    expect(html).not.toContain("RUNNING");
    expect(html).toContain("Completed");
    expect(html).toContain("review changes [commit|branch|pr], defaults to uncommitted");
  });

  test("wraps long unbroken subagent summary prose", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): long token", {
          id: "subagent-long-summary",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-long-summary",
            correlationKey: "part:assistant-task-tool-completed:subtask-long-summary",
            status: "completed",
            agent: "build",
            description: LONG_TRANSCRIPT_TOKEN,
            externalSessionId: "session-child-long-summary",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain(
      "whitespace-pre-wrap break-words line-clamp-2 text-sm text-muted-foreground",
    );
  });

  test("renders the subagent transcript action when a transcript target is available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-with-transcript-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "claude-subagent:child-agent-1",
            correlationKey: "session:assistant-1:session-parent::claude-subagent::child-agent-1",
            status: "completed",
            agent: "build",
            description: "review changes",
            externalSessionId: "session-parent::claude-subagent::child-agent-1",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
        sessionIdentity: {
          runtimeKind: "claude",
          workingDirectory: "/repo",
        },
        transcriptDialog: {
          openSessionTranscript: () => {},
          closeSessionTranscript: () => {},
        },
      }),
    );

    expect(html).toContain('aria-label="View subagent session"');
    expect(html).toContain("Subagent session");
  });

  test("renders a loader instead of duration for running subagent cards", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-running-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-running-1",
            correlationKey: "part:assistant-task-tool-running:subtask-b",
            status: "running",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-2",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Running");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain("1m");
    expect(html).not.toContain("59s");
  });

  test("renders running subagent cards as waiting when child session has pending approval", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-waiting-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-waiting-1",
            correlationKey: "part:assistant-task-tool-running:subtask-permission",
            status: "running",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-waiting",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingApprovalCount: 1,
      }),
    );

    expect(html).toContain("Waiting for input");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("Running");
  });

  test("renders running subagent cards as waiting when child session has pending question", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): answer prompt", {
          id: "subagent-waiting-question-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-waiting-question-1",
            correlationKey: "part:assistant-task-tool-running:subtask-question",
            status: "running",
            agent: "build",
            description: "answer prompt",
            externalSessionId: "session-child-question",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingQuestionCount: 1,
      }),
    );

    expect(html).toContain("Waiting for input");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("Running");
  });

  test("keeps terminal subagent status when child session still has stale pending approval", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-completed-stale-permission-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-completed-stale-permission-1",
            correlationKey: "part:assistant-task-tool-completed:subtask-permission",
            status: "completed",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-completed",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingApprovalCount: 1,
      }),
    );

    expect(html).toContain("Completed");
    expect(html).not.toContain("Waiting for input");
    expect(html).toContain("1m59s");
  });

  test("renders cancelled subagent cards with terminal duration", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-cancelled-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-cancelled-1",
            correlationKey: "part:assistant-task-tool-cancelled:subtask-c",
            status: "cancelled",
            agent: "build",
            description: "review changes [commit|branch|pr], cancelled by user",
            externalSessionId: "session-child-3",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Cancelled");
    expect(html).toContain("review changes [commit|branch|pr], cancelled by user");
    expect(html).toContain("1m59s");
  });

  test("renders failed subagent cards with runtime error details", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (explorer): read file", {
          id: "subagent-error-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-error-1",
            correlationKey: "part:assistant-task-tool-error:subtask-error",
            status: "error",
            agent: "explorer",
            description: "Read the file at ~/maxsky5.omp.json",
            error: "Timed out after 5m while waiting for permission.",
            externalSessionId: "session-child-error",
            startedAtMs: 1_000,
            endedAtMs: 301_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Failed");
    expect(html).toContain("Read the file at ~/maxsky5.omp.json");
    expect(html).toContain("Timed out after 5m while waiting for permission.");
  });

  test("wraps long unbroken subagent error prose", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: buildMessage("system", "Subagent (explorer): long error", {
          id: "subagent-long-error",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-long-error",
            correlationKey: "part:assistant-task-tool-error:subtask-long-error",
            status: "error",
            agent: "explorer",
            description: "Read a file",
            error: LONG_TRANSCRIPT_TOKEN,
            externalSessionId: "session-child-long-error",
            startedAtMs: 1_000,
            endedAtMs: 301_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain(
      "whitespace-pre-wrap break-words line-clamp-2 text-sm font-medium text-destructive",
    );
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
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("planner-main");
    expect(html).toContain("openai/gpt-5.3-codex");
    expect(html).toContain("gpt-5.3-codex");
    expect(html).toContain("high");
  });

  test("renders no-profile Codex assistant footer with the Codex session accent", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
        sessionIdentity: {
          ...DEFAULT_TEST_SESSION_IDENTITY,
          runtimeKind: "codex",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("codex/gpt-5.4-mini");
    expect(html).toContain("background-color:var(--odt-runtime-accent-codex)");
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
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain("tracking-wide");
    expect(html).not.toContain("border-l-2");
  });

  test("renders assistant footer color from message agent metadata", () => {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
    const html = await renderToHtml(
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
    const html = await renderToHtml(
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
        message: {
          id: "user-long-token",
          role: "user",
          content: LONG_TRANSCRIPT_TOKEN,
          timestamp: "2026-02-22T10:25:30.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("whitespace-pre-wrap break-words line-clamp-2 leading-6");
  });

  test("wraps long unbroken assistant plain prose", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
        message: {
          id: "assistant-long-token",
          role: "assistant",
          content: LONG_TRANSCRIPT_TOKEN,
          timestamp: "2026-02-22T10:25:45.000Z",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("whitespace-pre-wrap break-words line-clamp-2 leading-6");
  });

  test("does not color legacy user messages without send-time metadata", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
        sessionIdentity: {
          ...DEFAULT_TEST_SESSION_IDENTITY,
          runtimeKind: "codex",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-l-4");
    expect(html).toContain("border-left-color:var(--odt-runtime-accent-codex)");
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
      createElement(AgentChatMessageCard, {
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
        sessionAgentColors: {},
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
      createElement(AgentChatMessageCard, {
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
