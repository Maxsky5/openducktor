import { describe, expect, test } from "bun:test";
import type { ToolMessageMeta } from "./git-panel-refresh-policy";
import { shouldRefreshGitPanelAfterToolCompletion } from "./git-panel-refresh-policy";

const buildToolMeta = (tool: string, input?: Record<string, unknown>): ToolMessageMeta => ({
  kind: "tool",
  partId: `part-${tool}`,
  callId: `call-${tool}`,
  tool,
  status: "completed",
  ...(input ? { input } : {}),
});

describe("shouldRefreshGitPanelAfterToolCompletion", () => {
  test("refreshes for known file-editing tools", () => {
    const editTools = [
      "apply_patch",
      "edit",
      "file_write",
      "multiedit",
      "multi_edit",
      "patch",
      "str_replace",
      "str_replace_based_edit_tool",
      "write",
      "create",
      "insert",
      "replace",
      "ast_grep_replace",
      "lsp_rename",
    ];

    for (const tool of editTools) {
      expect(shouldRefreshGitPanelAfterToolCompletion(buildToolMeta(tool))).toBe(true);
    }
  });

  test("does not refresh for read-only, interaction, or unknown tools", () => {
    const ignoredTools = [
      "",
      "ast_grep_search",
      "grep",
      "look_at",
      "odt_read_task",
      "read",
      "skill",
      "todowrite",
      "unknown_runtime_tool",
      "webfetch",
    ];

    for (const tool of ignoredTools) {
      expect(shouldRefreshGitPanelAfterToolCompletion(buildToolMeta(tool))).toBe(false);
    }
  });

  test("refreshes for shell commands that can change git panel state", () => {
    const refreshCommands = [
      "git status",
      "rtk git diff --stat",
      "cd repo && git reset --soft HEAD~1",
      "pwd; git commit -m test",
      "touch src/generated.ts",
      "sed -i '' 's/a/b/' src/app.ts",
      "printf test > README.md",
      "cat source.ts | tee target.ts",
    ];

    for (const command of refreshCommands) {
      expect(shouldRefreshGitPanelAfterToolCompletion(buildToolMeta("bash", { command }))).toBe(
        true,
      );
    }
  });

  test("does not refresh for shell commands outside the git-panel refresh policy", () => {
    const ignoredCommands = ["", "pwd", "ls", "rg TODO", "cat README.md", "echo ready"];

    for (const command of ignoredCommands) {
      expect(shouldRefreshGitPanelAfterToolCompletion(buildToolMeta("bash", { command }))).toBe(
        false,
      );
    }
  });

  test("does not treat non-shell tool command inputs as shell commands", () => {
    expect(
      shouldRefreshGitPanelAfterToolCompletion(
        buildToolMeta("unknown_runtime_tool", { command: "git status" }),
      ),
    ).toBe(false);
  });
});
