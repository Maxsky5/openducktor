import { describe, expect, test } from "bun:test";
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
      expect(toolDisplayName("openducktor_odt_set_plan")).toBe("set_plan");
      expect(toolDisplayName("bash")).toBe("bash");
    });
  });

  describe("role and input helpers", () => {
    test("maps assistant role labels using metadata and session fallback", () => {
      const assistantMessage = createMessage({
        meta: {
          kind: "assistant",
          agentRole: "planner",
        },
      });

      expect(assistantRoleFromMessage(assistantMessage, "spec")).toBe("planner");
      expect(roleLabel("assistant", "build", assistantMessage)).toBe("Planner");

      const noMetaMessage = createMessage();
      expect(assistantRoleFromMessage(noMetaMessage, "qa")).toBe("qa");
      expect(roleLabel("assistant", "qa", noMetaMessage)).toBe("QA");
      expect(roleLabel("assistant", null, noMetaMessage)).toBe("Assistant");
    });

    test("returns non-assistant role labels", () => {
      const message = createMessage({ role: "system" });
      expect(assistantRoleFromMessage(createMessage({ role: "tool" }), "build")).toBeNull();
      expect(roleLabel("thinking", null, message)).toBe("Thinking");
      expect(roleLabel("tool", null, message)).toBe("Activity");
      expect(roleLabel("system", null, message)).toBe("System");
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
            status: "completed",
            output: "MCP error -32602: ignored for non-mutation",
          }),
        ),
      ).toBe(false);

      expect(
        isToolMessageFailure(
          createToolMeta({
            tool: "odt_set_plan",
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
            metadata: { questions: [{ question: "Should be ignored" }] },
          }),
        ),
      ).toEqual([]);
      expect(questionToolDetails(createToolMeta({ tool: "question", output: "{broken" }))).toEqual(
        [],
      );
      expect(
        questionToolDetails(createToolMeta({ tool: "question", output: "plain text" })),
      ).toEqual([]);
      expect(questionToolDetails(createToolMeta({ tool: "question", metadata: {} }))).toEqual([]);
    });

    test("prefers input questions over metadata and output questions", () => {
      const details = questionToolDetails(
        createToolMeta({
          tool: "QUESTION",
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
            output: JSON.stringify({ todos: [{ id: "1" }, { id: "2" }] }),
          }),
          "",
        ),
      ).toBe("2 todos");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "custom_todoread",
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
            output: JSON.stringify({ items: [{ id: "1" }, { id: "2" }] }),
          }),
          "",
        ),
      ).toBe("2 todos");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "  todoread  ",
            output: JSON.stringify({ todos: [{ id: "1" }] }),
          }),
          "",
        ),
      ).toBe("1 todo");
    });

    test("builds todo status summaries when counts are unavailable", () => {
      expect(
        buildToolSummary(createToolMeta({ tool: "todowrite", status: "pending", input: {} }), ""),
      ).toBe("updating todos");
      expect(buildToolSummary(createToolMeta({ tool: "todowrite", status: "running" }), "")).toBe(
        "updating todos",
      );
      expect(buildToolSummary(createToolMeta({ tool: "todowrite", status: "completed" }), "")).toBe(
        "todos updated",
      );
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "todowrite",
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
            status: "error",
            error: "boom",
          }),
          "",
        ),
      ).toBe("boom");
    });

    test("builds task summaries from metadata and session id", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "task",
            metadata: { summary: [{ id: 1 }, { id: 2 }] },
          }),
          "",
        ),
      ).toBe("2 subagent tool steps");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "task",
            metadata: { sessionId: "1234567890abcdef" },
          }),
          "",
        ),
      ).toBe("Subagent session 12345678");
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
            preview: "bun run test --filter @openducktor/desktop",
            title: "Run desktop tests",
            output: "completed shell execution",
          }),
          "",
        ),
      ).toBe("bun run test --filter @openducktor/desktop");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "skill",
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
            input: { pattern: "**/*.ts", path: "apps/desktop/src" },
          }),
          "",
        ),
      ).toBe("**/*.ts in apps/desktop/src");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "grep",
            input: { pattern: "agent", path: "." },
          }),
          "",
        ),
      ).toBe("agent");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "search",
            input: { path: "apps/desktop/src" },
          }),
          "",
        ),
      ).toBe("apps/desktop/src");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "find",
            input: { path: "." },
          }),
          "",
        ),
      ).toBe("workspace");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "read",
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
            input: { command: "bun run test --filter @openducktor/desktop" },
          }),
          "",
        ),
      ).toContain("bun run test");
    });

    test("builds summaries from structured output and falls back to content", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: JSON.stringify([{ id: "a" }, { id: "b" }]),
          }),
          "",
        ),
      ).toBe("2 subagent results");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: JSON.stringify({ summary: [{ id: "x" }, { id: "y" }] }),
          }),
          "",
        ),
      ).toBe("2 subagent results");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: JSON.stringify({ result: "delegated result" }),
          }),
          "",
        ),
      ).toBe("delegated result");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: "{}",
          }),
          "",
        ),
      ).toBe("{}");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: "plain text summary",
          }),
          "",
        ),
      ).toBe("plain text summary");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: "{broken",
          }),
          "",
        ),
      ).toBe("{broken");

      expect(
        buildToolSummary(
          createToolMeta({
            tool: "delegate",
            output: "[]",
          }),
          "",
        ),
      ).toBe("[]");

      const structuredMessageSummary = buildToolSummary(
        createToolMeta({
          tool: "subtask",
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

    test("computes duration from input-ready timestamp and completion timestamp", () => {
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
      ).toBe(130);

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            inputReadyAtMs: 10,
          }),
          "1970-01-01T00:00:00.040Z",
        ),
      ).toBe(30);

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

    test("falls back to observed and started/ended timestamps", () => {
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
      ).toBe(200);

      expect(
        getToolDuration(
          createToolMeta({
            status: "completed",
            observedStartedAtMs: 20,
          }),
          "1970-01-01T00:00:00.080Z",
        ),
      ).toBe(60);

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
            modelId: "gpt-5",
            profileId: "builder",
          },
        }),
        {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-4",
          profileId: "fallback",
        },
      );
      expect(footer.infoParts).toEqual(["builder", "gpt-5"]);
    });

    test("does not show footer for assistant messages without final metadata", () => {
      const footer = getAssistantFooterData(createMessage(), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        profileId: "planner-agent",
      });
      expect(footer.infoParts).toEqual([]);
    });

    test("does not show footer for streaming assistant messages", () => {
      const footer = getAssistantFooterData(
        createMessage({
          meta: {
            kind: "assistant",
            agentRole: "spec",
            isFinal: false,
            modelId: "gpt-5",
            profileId: "hephaestus",
          },
        }),
        {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          profileId: "planner-agent",
        },
      );
      expect(footer.infoParts).toEqual([]);
    });

    test("returns empty parts for non-assistant messages and blank metadata", () => {
      const nonAssistant = getAssistantFooterData(createMessage({ role: "tool" }), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        profileId: "planner-agent",
      });
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
        {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "fallback-model",
          profileId: "fallback-agent",
        },
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

    test("extracts file edit data from input path and metadata diff", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: { filePath: "src/app.ts" },
          metadata: {
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n+line",
          },
        }),
      );

      expect(data).toEqual({
        filePath: "src/app.ts",
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n+line\n",
        additions: 2,
        deletions: 1,
      });
    });

    test("normalizes file edit paths relative to the session working directory", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: {
            filePath: "/repo/apps/web/src/contexts/AuthContext.tsx",
          },
          metadata: {
            diff: "--- a/apps/web/src/contexts/AuthContext.tsx\n+++ b/apps/web/src/contexts/AuthContext.tsx\n@@ -1 +1 @@\n-old\n+new",
          },
        }),
        "/repo",
      );

      expect(data).toEqual({
        filePath: "apps/web/src/contexts/AuthContext.tsx",
        diff: "--- a/apps/web/src/contexts/AuthContext.tsx\n+++ b/apps/web/src/contexts/AuthContext.tsx\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
      });
    });

    test("extracts apply_patch file path and output fallback path", () => {
      const fromPatch = extractFileEditData(
        createToolMeta({
          input: {
            patch: "--- a/src/patch.ts\n+++ b/src/patch.ts\n@@ -1 +1 @@\n-old\n+new",
          },
        }),
      );
      expect(fromPatch).toEqual({
        filePath: "src/patch.ts",
        diff: "--- a/src/patch.ts\n+++ b/src/patch.ts\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
      });

      const fromOutput = extractFileEditData(
        createToolMeta({
          output: "Updated the following files: M src/output.ts\n@@ -1 +1 @@\n-old\n+new",
        }),
      );
      expect(fromOutput).toEqual({
        filePath: "src/output.ts",
        diff: "--- a/src/output.ts\n+++ b/src/output.ts\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
      });
    });

    test("selects the matching file diff from a multi-file patch", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: { filePath: "src/second.ts" },
          metadata: {
            diff:
              "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
              "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
          },
        }),
      );

      expect(data).toEqual({
        filePath: "src/second.ts",
        diff: "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
        additions: 2,
        deletions: 1,
      });
    });

    test("extracts a single classic diff section for the current file", () => {
      const data = extractFileEditData(
        createToolMeta({
          input: { filePath: "src/second.ts" },
          metadata: {
            diff:
              "Index: src/first.ts\n==================================================\n--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
              "Index: src/second.ts\n==================================================\n--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
          },
        }),
      );

      expect(data).toEqual({
        filePath: "src/second.ts",
        diff: "--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
        additions: 2,
        deletions: 1,
      });
    });

    test("extracts all file edit data from a multi-file git patch", () => {
      const data = extractAllFileEditData(
        createToolMeta({
          tool: "apply_patch",
          input: {
            patch:
              "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
              "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n" +
              "diff --git a/src/third.ts b/src/third.ts\n--- a/src/third.ts\n+++ b/src/third.ts\n@@ -1,2 +1 @@\n-old\n-remove\n+new\n",
          },
        }),
      );

      expect(data).toEqual([
        {
          filePath: "src/first.ts",
          diff: "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n",
          additions: 1,
          deletions: 1,
        },
        {
          filePath: "src/second.ts",
          diff: "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
          additions: 2,
          deletions: 1,
        },
        {
          filePath: "src/third.ts",
          diff: "diff --git a/src/third.ts b/src/third.ts\n--- a/src/third.ts\n+++ b/src/third.ts\n@@ -1,2 +1 @@\n-old\n-remove\n+new\n",
          additions: 1,
          deletions: 2,
        },
      ]);
    });

    test("extracts all file edit data from a multi-file classic diff", () => {
      const data = extractAllFileEditData(
        createToolMeta({
          tool: "apply_patch",
          metadata: {
            diff:
              "Index: src/first.ts\n==================================================\n--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
              "Index: src/second.ts\n==================================================\n--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
          },
        }),
      );

      expect(data).toEqual([
        {
          filePath: "src/first.ts",
          diff: "--- src/first.ts\n+++ src/first.ts\n@@ -1 +1 @@\n-old\n+new\n",
          additions: 1,
          deletions: 1,
        },
        {
          filePath: "src/second.ts",
          diff: "--- src/second.ts\n+++ src/second.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
          additions: 2,
          deletions: 1,
        },
      ]);
    });

    test("extractAllFileEditData preserves single-file behavior", () => {
      const meta = createToolMeta({
        tool: "apply_patch",
        input: {
          patch: "--- a/src/patch.ts\n+++ b/src/patch.ts\n@@ -1 +1 @@\n-old\n+new",
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
            input: { patch: "@@ -1 +1 @@\n-old\n+new" },
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
    test("summarizes multi-file apply_patch output by file count", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            input: {
              patch:
                "diff --git a/src/first.ts b/src/first.ts\n--- a/src/first.ts\n+++ b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n" +
                "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -1 +1 @@\n-old\n+new\n",
            },
            output: "Updated 2 files",
          }),
          "",
        ),
      ).toBe("2 files modified");
    });

    test("preserves single-file apply_patch summaries", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "apply_patch",
            input: {
              patch: "--- a/src/patch.ts\n+++ b/src/patch.ts\n@@ -1 +1 @@\n-old\n+new",
            },
            output: "Updated 1 file",
          }),
          "",
        ),
      ).toBe("src/patch.ts");
    });

    test("uses input taskId for read_task summaries", () => {
      expect(
        buildToolSummary(
          createToolMeta({
            tool: "odt_read_task",
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
