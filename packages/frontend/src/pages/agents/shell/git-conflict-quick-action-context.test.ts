import { describe, expect, mock, test } from "bun:test";
import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";
import { gitConflictQuickActionContextsEqual } from "./git-conflict-quick-action-context";

const createContext = (
  overrides: Partial<AgentStudioGitConflictQuickActionContext> = {},
): AgentStudioGitConflictQuickActionContext => ({
  conflict: {
    operation: "rebase",
    currentBranch: "feature/task-1",
    targetBranch: "origin/main",
    conflictedFiles: ["src/conflict.ts"],
    output: "CONFLICT (content): Merge conflict in src/conflict.ts",
    workingDir: "/repo/worktrees/task-1",
  },
  resolveWithBuilder: mock(async () => {}),
  isHandling: false,
  ...overrides,
});

describe("gitConflictQuickActionContextsEqual", () => {
  test("ignores callback identity when the quick action is semantically unchanged", () => {
    expect(gitConflictQuickActionContextsEqual(createContext(), createContext())).toBe(true);
  });

  test("detects meaningful conflict and handling changes", () => {
    const context = createContext();

    expect(
      gitConflictQuickActionContextsEqual(
        context,
        createContext({
          conflict: {
            ...context.conflict,
            conflictedFiles: ["src/other.ts"],
          },
        }),
      ),
    ).toBe(false);
    expect(gitConflictQuickActionContextsEqual(context, createContext({ isHandling: true }))).toBe(
      false,
    );
    expect(gitConflictQuickActionContextsEqual(context, null)).toBe(false);
  });
});
