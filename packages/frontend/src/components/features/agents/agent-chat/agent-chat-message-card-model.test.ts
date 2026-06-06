import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  assistantRoleFromMessage,
  buildToolSummary,
  extractAllFileEditData,
  extractFileEditData,
  formatRawJsonLikeText,
  formatTime,
  getAssistantFooterData,
  getToolDuration,
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
  isFileEditTool,
  isToolMessageCancelled,
  isToolMessageFailure,
  questionToolDetails,
  roleLabel,
  SYSTEM_PROMPT_PREFIX,
  stripToolPrefix,
  toolDisplayName,
  toSingleLineMarkdown,
} from "./agent-chat-message-card-model";

type ToolMeta = Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "tool" }>;

const createToolMeta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...overrides,
});

const createMessage = (overrides: Partial<AgentChatMessage> = {}): AgentChatMessage => ({
  id: "msg-1",
  role: "assistant",
  content: "hello",
  timestamp: "2026-02-22T10:00:00.000Z",
  ...overrides,
});

describe("agent-chat-message-card-model", () => {
  test("exports system prompt prefix constant", () => {
    expect(SYSTEM_PROMPT_PREFIX).toBe("System prompt:\n\n");
  });

  describe("formatting helpers", () => {
    test("formats time and returns empty string for invalid timestamps", () => {
      const timestamp = "2026-02-22T10:00:00.000Z";
      const formatted = formatTime(timestamp);
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}(?:\s*[AP]M)?$/);
      expect(formatTime("not-a-date")).toBe("");
    });

    test("formats raw JSON-like text and preserves non-JSON text", () => {
      expect(formatRawJsonLikeText("   ")).toBe("");
      expect(formatRawJsonLikeText('{"a":1}')).toContain('"a": 1');
      expect(formatRawJsonLikeText("[1,2]")).toContain("2");
      expect(formatRawJsonLikeText("{broken")).toBe("{broken");
      expect(formatRawJsonLikeText("not-json")).toBe("not-json");
    });

    test("strips tool prefixes and lifecycle prefixes", () => {
      expect(stripToolPrefix("read_task", "Tool read_task completed: loaded")).toBe("loaded");
      expect(stripToolPrefix("bash", "queued: npm test")).toBe("npm test");
      expect(stripToolPrefix("bash", "cancelled: interrupted by user")).toBe("interrupted by user");
      expect(stripToolPrefix("tool.with+regex", "Tool tool.with+regex running: ok")).toBe("ok");
    });

    test("converts markdown blocks to single line", () => {
      expect(toSingleLineMarkdown("line 1\n\n line 2   \nline 3")).toBe("line 1 line 2 line 3");
    });

    test("maps odt tool names to display names", () => {
      expect(toolDisplayName("odt_set_plan")).toBe("set_plan");
      expect(toolDisplayName("openducktor_odt_set_plan")).toBe("openducktor_odt_set_plan");
      expect(
        toolDisplayName(
          "openducktor_odt_set_plan",
          OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
        ),
      ).toBe("set_plan");
      expect(toolDisplayName("bash")).toBe("bash");
    });
  });

  describe("role and input helpers", () => {
    test("maps assistant role labels using assistant metadata only", () => {
      const assistantMessage = createMessage({
        meta: {
          kind: "assistant",
        },
      });

      expect(assistantRoleFromMessage(assistantMessage)).toBeNull();
      expect(roleLabel("assistant", assistantMessage)).toBe("Assistant");

      const noMetaMessage = createMessage();
      expect(assistantRoleFromMessage(noMetaMessage)).toBeNull();
      expect(roleLabel("assistant", noMetaMessage)).toBe("Assistant");
    });

    test("keeps planner assistant labels when metadata includes the planner role", () => {
      const plannerMessage = createMessage({
        meta: {
          kind: "assistant",
          agentRole: "planner",
        },
      });

      expect(assistantRoleFromMessage(plannerMessage)).toBe("planner");
      expect(roleLabel("assistant", plannerMessage)).toBe("Planner");
    });

    test("returns non-assistant role labels", () => {
      const message = createMessage({ role: "system" });
      expect(assistantRoleFromMessage(createMessage({ role: "tool" }))).toBeNull();
      expect(roleLabel("thinking", message)).toBe("Thinking");
      expect(roleLabel("tool", message)).toBe("Activity");
      expect(roleLabel("system", message)).toBe("System");
    });

    test("detects meaningful input values recursively", () => {
      expect(hasNonEmptyInput(undefined)).toBe(false);
      expect(hasNonEmptyInput({})).toBe(false);
      expect(hasNonEmptyInput({ a: "   ", b: { c: [] } })).toBe(false);
      expect(hasNonEmptyInput({ a: null })).toBe(false);
      expect(hasNonEmptyInput({ a: 0 })).toBe(true);
      expect(hasNonEmptyInput({ a: false })).toBe(true);
      expect(hasNonEmptyInput({ a: ["", "  ", { b: "ok" }] })).toBe(true);
    });

    test("detects non-empty text values", () => {
      expect(hasNonEmptyText(" hello ")).toBe(true);
      expect(hasNonEmptyText("   ")).toBe(false);
      expect(hasNonEmptyText(123)).toBe(false);
      expect(hasNonEmptyText(undefined)).toBe(false);
    });
  });

  describe("tool lifecycle helpers", () => {
    test("detects tool failures", () => {
      expect(isToolMessageFailure(createToolMeta({ status: "error" }))).toBe(true);

      expect(
        isToolMessageFailure(
          createToolMeta({
            status: "completed",
            output: "MCP error -32602: ignored because status stayed completed",
          }),
        ),
      ).toBe(false);

      expect(
        isToolMessageFailure(
          createToolMeta({
            tool: "read",
            toolType: "generic" as const,
            status: "completed",
            output: "MCP error -32602: ignored for non-mutation",
          }),
        ),
      ).toBe(false);

      expect(
        isToolMessageFailure(
          createToolMeta({
            tool: "odt_set_plan",
            toolType: "generic" as const,
            status: "completed",
            output: "Success",
          }),
        ),
      ).toBe(false);
    });

    test("detects cancelled tool messages from error and output", () => {
      expect(
        isToolMessageCancelled(
          createToolMeta({
            status: "running",
            error: "cancelled",
          }),
        ),
      ).toBe(false);

      expect(
        isToolMessageCancelled(
          createToolMeta({
            status: "error",
            error: "Execution aborted by user",
          }),
        ),
      ).toBe(true);

      expect(
        isToolMessageCancelled(
          createToolMeta({
            status: "error",
            output: "Request interrupted before completion",
          }),
        ),
      ).toBe(true);
    });

    test("derives lifecycle phases from status, payload and errors", () => {
      expect(getToolLifecyclePhase(createToolMeta({ status: "pending", input: {} }))).toBe(
        "queued",
      );
      expect(
        getToolLifecyclePhase(createToolMeta({ status: "pending", input: { taskId: "t1" } })),
      ).toBe("executing");
      expect(getToolLifecyclePhase(createToolMeta({ status: "running" }))).toBe("executing");
      expect(getToolLifecyclePhase(createToolMeta({ status: "completed" }))).toBe("completed");
      expect(
        getToolLifecyclePhase(
          createToolMeta({
            status: "error",
            error: "Input validation error",
          }),
        ),
      ).toBe("failed");
      expect(
        getToolLifecyclePhase(
          createToolMeta({
            status: "error",
            error: "Cannot update spec while task is closed.",
          }),
        ),
      ).toBe("failed");
      expect(
        getToolLifecyclePhase(
          createToolMeta({
            status: "error",
            error: "Tool call cancelled by user",
          }),
        ),
      ).toBe("cancelled");
      expect(getToolLifecyclePhase(createToolMeta({ status: "error", error: "boom" }))).toBe(
        "failed",
      );
    });
  });

  describe("question tool parsing", () => {
    test("returns empty details for non-question tools and empty question payloads", () => {
      expect(questionToolDetails(createToolMeta({ tool: "read" }))).toEqual([]);
      expect(
        questionToolDetails(
          createToolMeta({
            tool: "question_parser",
            toolType: "generic" as const,
            metadata: { questions: [{ question: "Should be ignored" }] },
          }),
        ),
      ).toEqual([]);
      expect(
        questionToolDetails(
          createToolMeta({ tool: "question", toolType: "question", output: "{broken" }),
        ),
      ).toEqual([]);
      expect(
        questionToolDetails(
          createToolMeta({ tool: "question", toolType: "question", output: "plain text" }),
        ),
      ).toEqual([]);
      expect(
        questionToolDetails(
          createToolMeta({ tool: "question", toolType: "question", metadata: {} }),
        ),
      ).toEqual([]);
    });

    test("prefers input questions over metadata and output questions", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "QUESTION",
          toolType: "question",
          input: {
            questions: [{ question: "Choose role", answers: ["planner"] }],
          },
          metadata: {
            questions: [{ question: "Ignored metadata question" }],
          },
          output: JSON.stringify({
            questions: [{ question: "Ignored output question" }],
            answers: [["build"]],
          }),
        }),
      );
      expect(details).toEqual([{ prompt: "Choose role", answers: ["planner"] }]);
    });

    test("uses metadata questions and normalizes object answer groups", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "my_question",
          toolType: "question",
          metadata: {
            questions: [{ title: "Environment?" }],
            answers: {
              first: [" staging ", " "],
              second: "prod",
            },
          },
        }),
      );

      expect(details).toEqual([{ prompt: "Environment?", answers: ["staging"] }]);
    });

    test("uses output questions and nested response answer groups", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "question",
          toolType: "question",
          output: JSON.stringify({
            questions: [{ header: "Pick first" }, { label: "Pick second" }],
            response: [{ value: "alpha" }, { value: ["beta", "  "] }],
          }),
        }),
      );

      expect(details).toEqual([
        { prompt: "Pick first", answers: ["alpha"] },
        { prompt: "Pick second", answers: ["beta"] },
      ]);
    });

    test("falls back to metadata answer groups when output answers are absent", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "question",
          toolType: "question",
          metadata: {
            questions: [{ question: "Approve?" }],
            answers: [["yes"]],
          },
        }),
      );

      expect(details).toEqual([{ prompt: "Approve?", answers: ["yes"] }]);
    });

    test("returns prompts with empty answers when no answer groups exist", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "question",
          toolType: "question",
          input: {
            questions: [{ question: "Anything else?" }],
          },
        }),
      );
      expect(details).toEqual([{ prompt: "Anything else?", answers: [] }]);
    });

    test("ignores malformed question entries before valid prompts", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "question",
          toolType: "question",
          metadata: {
            questions: [null, { foo: "bar" }, { question: "Final prompt" }],
          },
        }),
      );

      expect(details).toEqual([{ prompt: "Final prompt", answers: [] }]);
    });
  });

  describe("tool summary builder", () => {
    test("builds todo summaries from output and input data", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "todowrite",
            toolType: "todo",
            output: JSON.stringify({ todos: [{ id: "1" }, { id: "2" }] }),
          }),
          "",
        ),
      ).toBe("2 todos");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "custom_todoread",
            toolType: "todo",
            output: "{broken",
            input: { items: [{ id: "a" }] },
          }),
          "",
        ),
      ).toBe("1 todo");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "todowrite",
            toolType: "todo",
            output: JSON.stringify({ items: [{ id: "1" }, { id: "2" }] }),
          }),
          "",
        ),
      ).toBe("2 todos");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "  todoread  ",
            toolType: "todo",
            output: JSON.stringify({ todos: [{ id: "1" }] }),
          }),
          "",
        ),
      ).toBe("1 todo");
    });

    test("builds todo status summaries when counts are unavailable", () => {
      expect(
        buildToolSummary(
          createToolMeta({ tool: "todowrite", toolType: "todo", status: "pending", input: {} }),
          "",
        ),
      ).toBe("updating todos");
      expect(
        buildToolSummary(
          createToolMeta({ tool: "todowrite", toolType: "todo", status: "running" }),
          "",
        ),
      ).toBe("updating todos");
      expect(
        buildToolSummary(
          createToolMeta({ tool: "todowrite", toolType: "todo", status: "completed" }),
          "",
        ),
      ).toBe("todos updated");
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "todowrite",
            toolType: "todo",
            status: "error",
            error: "cancelled by user",
          }),
          "",
        ),
      ).toBe("todos update cancelled");
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "todowrite",
            toolType: "todo",
            status: "error",
            error: "boom",
          }),
          "",
        ),
      ).toBe("boom");
    });

    test("falls back to empty text when task metadata does not expose a generic summary", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "task",
            toolType: "generic" as const,
            metadata: { summary: [{ id: 1 }, { id: 2 }] },
          }),
          "",
        ),
      ).toBe("");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "task",
            toolType: "generic" as const,
            metadata: { externalSessionId: "1234567890abcdef" },
          }),
          "",
        ),
      ).toBe("");
    });

    test("prefers explicit error text and title with compaction", () => {
      const longError = "x".repeat(260);
      const errorSummary = buildToolSummary(
        createToolMeta({
          status: "error",
          error: longError,
        }),
        "",
      );
      expect(errorSummary.startsWith("x".repeat(40))).toBe(true);
      expect(errorSummary.endsWith("...")).toBe(true);
      expect(errorSummary.length).toBeLessThanOrEqual(223);

      const longTitle = "t".repeat(200);
      const titleSummary = buildToolSummary(createToolMeta({ title: longTitle }), "");
      expect(titleSummary.startsWith("t".repeat(40))).toBe(true);
      expect(titleSummary.endsWith("...")).toBe(true);
      expect(titleSummary.length).toBeLessThanOrEqual(163);
    });

    test("prefers preview hints over tool titles and output, but keeps errors first", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "bash",
            toolType: "bash",
            preview: "bun run test --filter @openducktor/frontend",
            title: "Run desktop tests",
            output: "completed shell execution",
          }),
          "",
        ),
      ).toBe("bun run test --filter @openducktor/frontend");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "skill",
            toolType: "generic" as const,
            status: "error",
            preview: "clean-ddd-hexagonal",
            error: "Skill not found",
          }),
          "",
        ),
      ).toBe("Skill not found");
    });

    test("builds search and path summaries", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "glob",
            toolType: "generic" as const,
            input: { pattern: "**/*.ts", path: "packages/frontend/src" },
          }),
          "",
        ),
      ).toBe("**/*.ts in packages/frontend/src");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "grep",
            toolType: "generic" as const,
            input: { pattern: "agent", path: "." },
          }),
          "",
        ),
      ).toBe("agent");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "search",
            toolType: "generic" as const,
            input: { path: "packages/frontend/src" },
          }),
          "",
        ),
      ).toBe("packages/frontend/src");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "find",
            toolType: "generic" as const,
            input: { path: "." },
          }),
          "",
        ),
      ).toBe("workspace");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "read",
            toolType: "generic" as const,
            input: { filePath: "docs/task-workflow.md" },
          }),
          "",
        ),
      ).toBe("docs/task-workflow.md");
    });

    test("uses bash command summaries", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "bash",
            toolType: "bash",
            input: { command: "bun run test --filter @openducktor/frontend" },
          }),
          "",
        ),
      ).toContain("bun run test");
    });

    test("prefers bash input command over shell wrapper titles", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "bash",
            toolType: "bash",
            title: "/bin/zsh -lc 'cd /repo && bun test'",
            preview: "/bin/zsh -lc 'cd /repo && bun test'",
            input: { command: "cd /repo && bun test" },
          }),
          "",
        ),
      ).toBe("cd /repo && bun test");
    });

    test("builds summaries from structured output and falls back to content", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: JSON.stringify([{ id: "a" }, { id: "b" }]),
          }),
          "",
        ),
      ).toBe('[{"id":"a"},{"id":"b"}]');

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: JSON.stringify({ summary: [{ id: "x" }, { id: "y" }] }),
          }),
          "",
        ),
      ).toBe('{"summary":[{"id":"x"},{"id":"y"}]}');

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: JSON.stringify({ result: "delegated result" }),
          }),
          "",
        ),
      ).toBe("delegated result");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: "{}",
          }),
          "",
        ),
      ).toBe("{}");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: "plain text summary",
          }),
          "",
        ),
      ).toBe("plain text summary");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: "{broken",
          }),
          "",
        ),
      ).toBe("{broken");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            toolType: "generic" as const,
            output: "[]",
          }),
          "",
        ),
      ).toBe("[]");

      const structuredMessageSummary = buildToolSummary(
        createToolMeta({
          tool: "subtask",
          toolType: "generic" as const,
          output: JSON.stringify({ message: "done ".repeat(80) }),
        }),
        "",
      );
      expect(structuredMessageSummary.startsWith("done done done")).toBe(true);
      expect(structuredMessageSummary.endsWith("...")).toBe(true);
      expect(structuredMessageSummary.length).toBeLessThanOrEqual(163);

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "read",
            toolType: "generic" as const,
            output: "large content that should be ignored",
          }),
          "Tool read completed: fetched README",
        ),
      ).toBe("fetched README");

      expect(buildToolSummary(createToolMeta({ tool: "read", output: "" }), "")).toBe("");
    });
  });

  describe("tool duration", () => {
    test("returns null for queued and executing phases", () => {
      expect(
        getToolDuration(
          createToolMeta({ status: "pending", input: {} }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBeNull();
      expect(
        getToolDuration(
          createToolMeta({
            status: "running",
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBeNull();
    });

    test("uses runtime part timing only", () => {
      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            inputReadyAtMs: 130,
            observedEndedAtMs: 260,
            startedAtMs: 100,
            endedAtMs: 150,
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBe(50);

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            inputReadyAtMs: 10,
          }),
          "1970-01-01T00:00:00.040Z",
        ),
      ).toBeNull();

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            input: { prompt: "hi" },
            startedAtMs: 10,
            endedAtMs: 40,
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBe(30);
    });

    test("returns null when only locally observed timing is available", () => {
      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            inputReadyAtMs: 500,
            observedStartedAtMs: 100,
            observedEndedAtMs: 300,
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBeNull();

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            observedStartedAtMs: 20,
          }),
          "1970-01-01T00:00:00.080Z",
        ),
      ).toBeNull();

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            startedAtMs: 100,
            endedAtMs: 160,
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBe(60);
    });

    test("returns null when duration cannot be derived", () => {
      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            startedAtMs: 200,
            endedAtMs: 100,
          }),
          "2026-02-22T10:00:00.000Z",
        ),
      ).toBeNull();

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
          }),
          "not-a-date",
        ),
      ).toBeNull();

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            startedAtMs: 200,
          }),
          "not-a-date",
        ),
      ).toBeNull();
    });
  });

  describe("assistant footer", () => {
    test("returns metadata labels for assistant messages", () => {
      const footer = getAssistantFooterData(
        createMessage({
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "builder",
          },
        }),
      );
      expect(footer.infoParts).toEqual(["builder", "openai/gpt-5", "high"]);
    });

    test("omits blank variant and missing provider or model segments", () => {
      const footer = getAssistantFooterData(
        createMessage({
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            providerId: "openai",
            modelId: " ",
            variant: "   ",
            profileId: "builder",
          },
        }),
      );

      expect(footer.infoParts).toEqual(["builder", "openai"]);
    });

    test("does not show footer for assistant messages without final metadata", () => {
      const footer = getAssistantFooterData(createMessage());
      expect(footer.infoParts).toEqual([]);
    });

    test("does not show footer for streaming assistant messages", () => {
      const footer = getAssistantFooterData(
        createMessage({
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: false,
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "hephaestus",
          },
        }),
      );
      expect(footer.infoParts).toEqual([]);
    });

    test("returns empty parts for non-assistant messages and blank metadata", () => {
      const nonAssistant = getAssistantFooterData(createMessage({ role: "tool" }));
      expect(nonAssistant.infoParts).toEqual([]);

      const blankMeta = getAssistantFooterData(
        createMessage({
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: true,
            modelId: "   ",
            profileId: " ",
          },
        }),
      );
      expect(blankMeta.infoParts).toEqual([]);
    });
  });

  describe("file edit helpers", () => {
    test("detects file edit tools case-insensitively", () => {
      expect(isFileEditTool("edit")).toBe(true);
      expect(isFileEditTool("Apply_Patch")).toBe(true);
      expect(isFileEditTool("write")).toBe(true);
      expect(isFileEditTool("read")).toBe(false);
    });

    test("extracts metadata-only file edit data from input path", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: { filePath: "src/app.ts" },
        }),
      );

      expect(data).toEqual({
        filePath: "src/app.ts",
        diff: null,
        additions: 0,
        deletions: 0,
      });
    });

    test("normalizes metadata-only file edit paths relative to the session working directory", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: {
            filePath: "/repo/apps/web/src/contexts/AuthContext.tsx",
          },
        }),
        "/repo",
      );

      expect(data).toEqual({
        filePath: "apps/web/src/contexts/AuthContext.tsx",
        diff: null,
        additions: 0,
        deletions: 0,
      });
    });

    test("extracts structured file changes from tool metadata", () => {
      const data = extractAllFileEditData(
        createToolMeta({
          tool: "edit",
          toolType: "file_edit",
          fileChanges: [
            {
              file: "/repo/src/app.ts",
              type: "modified",
              additions: 4,
              deletions: 2,
              diff: "@@ -1 +1,3 @@\n-old\n+new\n+line\n",
            },
            {
              file: "/repo/src/empty.ts",
              type: "modified",
              additions: 0,
              deletions: 0,
              diff: "",
            },
          ],
        }),
        "/repo",
      );

      expect(data).toEqual([
        {
          filePath: "src/app.ts",
          diff: "@@ -1 +1,3 @@\n-old\n+new\n+line\n",
          additions: 4,
          deletions: 2,
        },
        {
          filePath: "src/empty.ts",
          diff: null,
          additions: 0,
          deletions: 0,
        },
      ]);
    });

    test("extractAllFileEditData preserves single-file behavior", () => {
      const meta = createToolMeta({
        tool: "edit",
        toolType: "file_edit",
        input: {
          filePath: "src/app.ts",
        },
      });
      const singleFileEditData = extractFileEditData(meta);

      expect(singleFileEditData).not.toBeNull();
      expect(extractAllFileEditData(meta)).toEqual(singleFileEditData ? [singleFileEditData] : []);
    });

    test("extractAllFileEditData returns an empty array when no file path is extractable", () => {
      expect(
        extractAllFileEditData(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            input: { patch: "@@ -1 +1 @@\n-old\n+new" },
            metadata: {
              diff: "@@ -1 +1 @@\n-old\n+new",
              changes: [{ path: "src/app.ts", diff: "@@ -1 +1 @@\n-old\n+new" }],
            },
            output: "Updated the following files: M src/app.ts",
          }),
        ),
      ).toEqual([]);
    });

    test("returns null when no file path can be extracted", () => {
      expect(
        extractFileEditData(
          createToolMeta({
            input: { filePath: "   " },
            output: "tool output without file markers",
          }),
        ),
      ).toBeNull();
    });
  });

  describe("tool summary helpers", () => {
    test("omits summaries for successful multi-file apply_patch tool calls", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            fileChanges: [
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
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            output: "Updated 2 files",
          }),
          "",
        ),
      ).toBe("");
    });

    test("omits summaries for successful single-file apply_patch tool calls", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            fileChanges: [
              {
                file: "src/patch.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            output: "Updated 1 file",
          }),
          "",
        ),
      ).toBe("");
    });

    test("uses neutral multi-file summaries while file edit tools are still running", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            status: "running",
            fileChanges: [
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
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
            output: "",
          }),
          "",
        ),
      ).toBe("2 files");
    });

    test("preserves file edit summaries until the tool succeeds", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            status: "running",
            input: {
              filePath: "src/patch.ts",
            },
            output: "",
          }),
          "",
        ),
      ).toBe("src/patch.ts");
    });

    test("keeps completed file edit summaries when no file cards can be built", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            toolType: "file_edit",
            status: "completed",
            output: "Success. Updated 3 files",
          }),
          "",
        ),
      ).toBe("Success. Updated 3 files");
    });

    test("uses input taskId for read_task summaries", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "odt_read_task",
            toolType: "generic" as const,
            input: { taskId: "task-77" },
            output: '{"task":{"id":"task-77","title":"Improve chat tool previews"}}',
          }),
          "",
        ),
      ).toBe("task-77");
    });

    test("preserves read_task error summaries when taskId is present", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "odt_read_task",
            toolType: "generic" as const,
            status: "error",
            input: { taskId: "task-77" },
            error: "Task not found",
          }),
          "",
        ),
      ).toBe("Task not found");
    });

    test("normalizes read tool paths relative to the session working directory", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "read",
            toolType: "generic" as const,
            preview: "/repo/apps/web/src/contexts/AuthContext.tsx",
            input: { path: "/repo/apps/web/src/contexts/AuthContext.tsx" },
          }),
          "",
          "/repo",
        ),
      ).toBe("apps/web/src/contexts/AuthContext.tsx");
    });

    test("normalizes lsp diagnostic paths relative to the session working directory", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "lsp_diagnostics",
            toolType: "generic" as const,
            preview: "/repo/apps/web/src/contexts/AuthContext.tsx",
            input: { path: "/repo/apps/web/src/contexts/AuthContext.tsx" },
          }),
          "",
          "/repo",
        ),
      ).toBe("apps/web/src/contexts/AuthContext.tsx");
    });

    test("normalizes search-style path summaries for ast_grep_search", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "ast_grep_search",
            toolType: "generic" as const,
            preview: "useState in /repo/apps/web/src",
            input: { query: "useState", path: "/repo/apps/web/src" },
          }),
          "",
          "/repo",
        ),
      ).toBe("useState in apps/web/src");
    });

    test("normalizes look_at paths relative to the session working directory", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "look_at",
            toolType: "generic" as const,
            preview: "/repo/apps/web/src/contexts/AuthContext.tsx",
            input: { path: "/repo/apps/web/src/contexts/AuthContext.tsx" },
          }),
          "",
          "/repo",
        ),
      ).toBe("apps/web/src/contexts/AuthContext.tsx");
    });
  });
});
