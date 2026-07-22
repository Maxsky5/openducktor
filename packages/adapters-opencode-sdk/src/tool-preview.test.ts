import { describe, expect, test } from "bun:test";
import { deriveToolPreview } from "./tool-preview";

describe("deriveToolPreview", () => {
  test("uses generic input when a specialized preview has no matching field", () => {
    const cases = [
      { tool: "bash", rawInput: { description: "shell fallback" } },
      { tool: "question", rawInput: { name: "question fallback" } },
      { tool: "odt_set_spec", rawInput: { description: "workflow fallback" } },
      { tool: "webfetch", rawInput: { description: "web fallback" } },
      { tool: "session_read", rawInput: { description: "session fallback" } },
    ] as const;

    for (const testCase of cases) {
      expect(
        deriveToolPreview({
          tool: testCase.tool,
          rawInput: testCase.rawInput,
          rawOutput: undefined,
        }),
      ).toBe(testCase.rawInput.description ?? testCase.rawInput.name);
    }
  });

  test("derives previews for namespaced ODT tool ids", () => {
    expect(
      deriveToolPreview({
        tool: "functions.openducktor_odt_set_plan",
        rawInput: {
          taskId: "task-42",
          subtasks: [{ id: "1" }, { id: "2" }],
        },
        rawOutput: undefined,
      }),
    ).toBe("task-42 · 2 subtasks");
  });

  test("handles singular lsp_diagnostic tool ids like other lsp tools", () => {
    expect(
      deriveToolPreview({
        tool: "lsp_diagnostic",
        rawInput: {
          symbol: "AuthContext",
          path: "/repo/apps/web/src/contexts/AuthContext.tsx",
        },
        rawOutput: undefined,
      }),
    ).toBe("AuthContext");
  });

  test("does not treat substring matches as question tools", () => {
    expect(
      deriveToolPreview({
        tool: "question_parser",
        rawInput: {
          name: "parse-questions",
          questions: [{ question: "Which runtime should we use?" }],
        },
        rawOutput: undefined,
      }),
    ).toBe("parse-questions");
  });

  test("derives skill previews from slash and backslash separated paths", () => {
    expect(
      deriveToolPreview({
        tool: "skill",
        rawInput: {
          path: "C:\\Users\\max\\.codex\\skills\\review-code.md",
        },
        rawOutput: undefined,
      }),
    ).toBe("review-code");
  });
});
