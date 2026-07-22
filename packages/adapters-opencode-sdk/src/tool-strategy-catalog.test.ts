import { describe, expect, test } from "bun:test";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { deriveToolPreview, deriveToolType } from "./tool-preview";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";

describe("OpenCode tool strategy catalog", () => {
  test("marks normalized task tools as subagent stream parts", () => {
    for (const toolName of ["task", "delegate", "functions.task", " Functions.Delegate "]) {
      expect(resolveOpencodeToolStrategy(toolName).streamPartKind, toolName).toBe("subagent");
    }

    for (const toolName of ["bash", "custom_runtime_tool"]) {
      expect(resolveOpencodeToolStrategy(toolName).streamPartKind, toolName).toBe("tool");
    }
  });

  test("classifies and previews each supported tool family from one strategy", () => {
    const cases = [
      {
        label: "shell",
        tool: "bash",
        rawInput: { command: "bun run test" },
        rawOutput: undefined,
        expectedType: "bash",
        expectedPreview: "bun run test",
      },
      {
        label: "read",
        tool: "read",
        rawInput: { filePath: "/repo/src/index.ts" },
        rawOutput: undefined,
        expectedType: "read",
        expectedPreview: "/repo/src/index.ts",
      },
      {
        label: "list",
        tool: "list",
        rawInput: { path: "/repo/src" },
        rawOutput: undefined,
        expectedType: "list",
        expectedPreview: "/repo/src",
      },
      {
        label: "search",
        tool: "grep",
        rawInput: { pattern: "deriveToolType", path: "/repo/src" },
        rawOutput: undefined,
        expectedType: "search",
        expectedPreview: "deriveToolType in /repo/src",
      },
      {
        label: "todo",
        tool: "todowrite",
        rawInput: { todos: [{ content: "Add catalog" }, { content: "Run tests" }] },
        rawOutput: undefined,
        expectedType: "todo",
        expectedPreview: "2 todos",
      },
      {
        label: "file edit",
        tool: "apply_patch",
        rawInput: { filePath: "/repo/src/tool-preview.ts", patch: "@@" },
        rawOutput: undefined,
        expectedType: "file_edit",
        expectedPreview: "/repo/src/tool-preview.ts",
      },
      {
        label: "question",
        tool: "question",
        rawInput: { questions: [{ question: "Keep the current preview?" }] },
        rawOutput: undefined,
        expectedType: "question",
        expectedPreview: "Keep the current preview?",
      },
      {
        label: "subagent task",
        tool: "task",
        rawInput: { agent: "build", prompt: "Inspect the adapter" },
        rawOutput: undefined,
        expectedType: "generic",
        expectedPreview: "build",
      },
      {
        label: "web",
        tool: "websearch",
        rawInput: { query: "OpenCode SDK tools" },
        rawOutput: undefined,
        expectedType: "web",
        expectedPreview: "OpenCode SDK tools",
      },
      {
        label: "session",
        tool: "session_read",
        rawInput: { sessionId: "session-42" },
        rawOutput: undefined,
        expectedType: "generic",
        expectedPreview: "session-42",
      },
      {
        label: "generic fallback",
        tool: "custom_runtime_tool",
        rawInput: { description: "Inspect runtime state" },
        rawOutput: undefined,
        expectedType: "generic",
        expectedPreview: "Inspect runtime state",
      },
    ] as const;

    for (const testCase of cases) {
      const strategy = resolveOpencodeToolStrategy(testCase.tool);
      expect(strategy.toolType, testCase.label).toBe(testCase.expectedType);
      expect(deriveToolType(testCase.tool), testCase.label).toBe(testCase.expectedType);
      expect(
        deriveToolPreview({
          tool: testCase.tool,
          rawInput: testCase.rawInput,
          rawOutput: testCase.rawOutput,
        }),
        testCase.label,
      ).toBe(testCase.expectedPreview);
    }
  });

  test("preserves the shorter preview limit only for the literal bash tool", () => {
    const command = "x".repeat(200);

    expect(deriveToolPreview({ tool: "bash", rawInput: { command }, rawOutput: undefined })).toBe(
      `${"x".repeat(120)}...`,
    );

    for (const tool of ["shell", "exec", "command"]) {
      expect(deriveToolPreview({ tool, rawInput: { command }, rawOutput: undefined }), tool).toBe(
        `${"x".repeat(160)}...`,
      );
    }
  });

  test("keeps exact webfetch parsing separate from prefixed webfetch tools", () => {
    expect(
      deriveToolPreview({
        tool: "webfetch",
        rawInput: { href: "https://openducktor.dev/docs" },
        rawOutput: undefined,
      }),
    ).toBe("https://openducktor.dev/docs");

    expect(
      deriveToolPreview({
        tool: "webfetch_custom",
        rawInput: { href: "https://openducktor.dev/docs" },
        rawOutput: undefined,
      }),
    ).toBeUndefined();
  });

  test("uses the runtime descriptor aliases for workflow classification", () => {
    for (const canonicalName of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      const aliases = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical[canonicalName];
      expect(aliases).toHaveLength(2);

      for (const toolName of [canonicalName, ...(aliases ?? [])]) {
        expect(resolveOpencodeToolStrategy(toolName)).toMatchObject({
          canonicalName,
          toolType: "workflow",
          previewStrategy: "workflow",
        });
        expect(deriveToolType(toolName)).toBe("workflow");
      }
    }
  });

  test("previews canonical and prefixed workflow aliases with canonical parsing", () => {
    const cases = [
      {
        canonicalName: "odt_read_task",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
      {
        canonicalName: "odt_read_task_documents",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
      {
        canonicalName: "odt_set_spec",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
      {
        canonicalName: "odt_set_plan",
        rawInput: { taskId: "task-42", subtasks: [{ id: "1" }, { id: "2" }] },
        expectedPreview: "task-42 · 2 subtasks",
      },
      {
        canonicalName: "odt_build_blocked",
        rawInput: { taskId: "task-42", reason: "Waiting for design input" },
        expectedPreview: "Waiting for design input",
      },
      {
        canonicalName: "odt_build_resumed",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
      {
        canonicalName: "odt_build_completed",
        rawInput: { taskId: "task-42", summary: "Catalog complete" },
        expectedPreview: "Catalog complete",
      },
      {
        canonicalName: "odt_set_pull_request",
        rawInput: { taskId: "task-42", providerId: "github", number: 17 },
        expectedPreview: "task-42 · github · #17",
      },
      {
        canonicalName: "odt_qa_approved",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
      {
        canonicalName: "odt_qa_rejected",
        rawInput: { taskId: "task-42" },
        expectedPreview: "task-42",
      },
    ] as const;

    for (const testCase of cases) {
      const aliases =
        OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical[testCase.canonicalName] ?? [];
      for (const toolName of [testCase.canonicalName, ...aliases]) {
        expect(
          deriveToolPreview({
            tool: toolName,
            rawInput: testCase.rawInput,
            rawOutput: undefined,
          }),
        ).toBe(testCase.expectedPreview);
      }
    }
  });
});
