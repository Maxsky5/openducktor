import { expect, test } from "bun:test";
import {
  buildGitConflictAssistancePrompt,
  type GitConflictRequestContext,
} from "./agent-system-prompts";

const git: GitConflictRequestContext = {
  operation: "pull_rebase",
  workingDirectory: "/repo/saved-worktree/",
  currentBranch: null,
  targetBranch: null,
  conflictedFiles: ["src/conflict.ts"],
  conflictOutput: null,
};

test.each([
  ["rebase", "rebase"],
  ["pull_rebase", "pull with rebase"],
  ["direct_merge_merge_commit", "direct merge with a merge commit"],
  ["direct_merge_squash", "direct squash merge"],
  ["direct_merge_rebase", "direct merge with rebase"],
] as const)(
  "workspace prompt keeps reported %s facts and has no task policy",
  (operation, label) => {
    const prompt = buildGitConflictAssistancePrompt({ git: { ...git, operation } });
    expect(prompt).toContain(`Operation: ${label}`);
    expect(prompt).toContain("Working directory: /repo/saved-worktree/");
    expect(prompt).toContain("src/conflict.ts");
    expect(prompt).toContain("Current branch: Unavailable");
    expect(prompt).toContain("Target branch: Unavailable");
    expect(prompt).toContain("Git output:\nUnavailable");
    expect(prompt).toContain("Do not abort the git operation unless explicitly asked");
    expect(prompt).not.toContain("taskId");
    expect(prompt).not.toContain("odt_");
    expect(prompt).not.toContain("Builder");
  },
);

test("active custom task text retains the required directory and evidence", () => {
  const prompt = buildGitConflictAssistancePrompt({
    git: { ...git, conflictedFiles: [], conflictOutput: "Git diagnostic" },
    task: {
      context: { taskId: "task-1" },
      overrides: {
        "message.build_rebase_conflict_resolution": {
          enabled: true,
          baseVersion: 1,
          template: "Custom instructions for {{task.id}}",
        },
      },
    },
  });
  expect(prompt).toContain("Custom instructions for task-1");
  expect(prompt).toContain("Working directory: /repo/saved-worktree/");
  expect(prompt).toContain("Conflicted files:\n  Unavailable");
  expect(prompt).toContain("Git diagnostic");
});

test("missing conflict directory blocks prompt construction", () => {
  expect(() => buildGitConflictAssistancePrompt({ git: { ...git, workingDirectory: "" } })).toThrow(
    "Restore the Git conflict operation and working directory",
  );
});
