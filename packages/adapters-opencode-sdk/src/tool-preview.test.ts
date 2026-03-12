import { describe, expect, test } from "bun:test";
import { deriveToolPreview } from "./tool-preview";

describe("deriveToolPreview", () => {
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
});
