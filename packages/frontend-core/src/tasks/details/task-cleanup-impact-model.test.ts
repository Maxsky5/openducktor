import { describe, expect, test } from "bun:test";
import type { TaskStopImpactState } from "../../queries/use-task-stop-impact";
import { buildTaskConfirmImpact } from "./task-cleanup-impact-model";
import { buildTaskDeleteConfirmCopy } from "./task-confirm-copy";
import type { TaskCleanupImpact } from "./use-task-cleanup-impact";

// The session of an approved task still names the worktree that Approve removed.
const sessionCleanup = (): TaskCleanupImpact => ({
  hasCanonicalWorktree: false,
  hasManagedSessionCleanup: true,
  managedWorktreeCount: 1,
  legacyWorktreeCount: 1,
  impactError: null,
  isLoadingImpact: false,
  terminalCount: 0,
});

const stopImpact = (overrides: Partial<TaskStopImpactState> = {}): TaskStopImpactState => ({
  stoppableSessionCount: 0,
  removedWorktreeCount: 0,
  isLoading: false,
  error: null,
  ...overrides,
});

const subject = { id: "task-1", title: "Approved task" };

describe("buildTaskConfirmImpact", () => {
  test("counts the worktrees that the host still finds", () => {
    const impact = buildTaskConfirmImpact(sessionCleanup(), stopImpact());

    expect(impact).toMatchObject({ hasManagedSessionCleanup: false, managedWorktreeCount: 0 });
    const lines = buildTaskDeleteConfirmCopy(subject, impact, 0).lines.map((line) => line.text);
    expect(lines.some((text) => text.includes("worktree"))).toBe(false);
  });

  test("names each worktree that the host removes", () => {
    const impact = buildTaskConfirmImpact(
      sessionCleanup(),
      stopImpact({ removedWorktreeCount: 2 }),
    );

    expect(impact).toMatchObject({ hasManagedSessionCleanup: true, managedWorktreeCount: 2 });
  });

  test("keeps the session count when the host omits the worktree count", () => {
    const impact = buildTaskConfirmImpact(
      sessionCleanup(),
      stopImpact({ removedWorktreeCount: null }),
    );

    expect(impact).toMatchObject({ hasManagedSessionCleanup: true, managedWorktreeCount: 1 });
  });

  test("checks the cleanup until the host returns the worktree count", () => {
    const impact = buildTaskConfirmImpact(
      sessionCleanup(),
      stopImpact({ stoppableSessionCount: null, removedWorktreeCount: null, isLoading: true }),
    );

    expect(impact).toMatchObject({ isLoading: true, isLoadingStopImpact: true });
  });
});
