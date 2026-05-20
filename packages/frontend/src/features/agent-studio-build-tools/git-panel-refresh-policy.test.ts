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
      "git;",
      "git && echo done",
      "GIT_DIR=.git git status",
      "GIT_AUTHOR_NAME=bot git commit -m test",
      "env FOO=1 git status",
      "rtk git diff --stat",
      "cd repo && git reset --soft HEAD~1",
      "pwd; git commit -m test",
      "(git status)",
      "{ git status; }",
      "touch src/generated.ts",
      "ln -s source target",
      "rsync -a src/ dist/",
      "tar -xf archive.tar",
      "unzip archive.zip",
      "sed -i '' 's/a/b/' src/app.ts",
      "sed -ni 's/a/b/' src/app.ts",
      "sed -in 's/a/b/' src/app.ts",
      "perl -pi -e 's/a/b/' src/app.ts",
      "printf test > README.md",
      "printf test >> README.md",
      "cat source.ts | tee target.ts",
    ];

    for (const command of refreshCommands) {
      expect(shouldRefreshGitPanelAfterToolCompletion(buildToolMeta("bash", { command }))).toBe(
        true,
      );
    }
  });

  test("does not refresh for shell commands outside the git-panel refresh policy", () => {
    const ignoredCommands = [
      "",
      "pwd",
      "ls",
      "rg TODO",
      "cat README.md",
      "echo ready",
      "cmd 2>&1",
      "exec 3>&2",
    ];

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
