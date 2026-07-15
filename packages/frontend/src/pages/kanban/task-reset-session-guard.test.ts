import { describe, expect, test } from "bun:test";
import { createAgentSessionSummaryFixture } from "@/test-utils/shared-test-fixtures";
import { isActiveSessionUsingImplementationWorktree } from "./task-reset-session-guard";

const waitingSession = (overrides: {
  role: "spec" | "planner" | "build" | "qa";
  workingDirectory: string;
}) =>
  createAgentSessionSummaryFixture({
    taskId: "TASK-123",
    ...overrides,
    pendingQuestions: [
      {
        requestId: "question-1",
        questions: [
          {
            header: "Decision",
            question: "Can reset continue?",
            options: [{ label: "No", description: "Keep waiting" }],
          },
        ],
      },
    ],
  });

describe("isActiveSessionUsingImplementationWorktree", () => {
  test("matches Spec and Planner only to the expected canonical task worktree", () => {
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "spec", workingDirectory: "/worktrees/TASK-123/" }),
        "/worktrees",
      ),
    ).toBe(true);
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "planner", workingDirectory: "/repo" }),
        "/worktrees",
      ),
    ).toBe(false);
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "planner", workingDirectory: "/legacy/TASK-123" }),
        "/worktrees",
      ),
    ).toBe(false);
  });

  test("normalizes Windows task worktree paths", () => {
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "spec", workingDirectory: "C:\\Worktrees\\TASK-123" }),
        "c:/worktrees/",
      ),
    ).toBe(true);
  });

  test("continues guarding Builder and QA sessions without worktree inference", () => {
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "build", workingDirectory: "/repo" }),
        null,
      ),
    ).toBe(true);
    expect(
      isActiveSessionUsingImplementationWorktree(
        waitingSession({ role: "qa", workingDirectory: "/legacy" }),
        null,
      ),
    ).toBe(true);
  });
});
