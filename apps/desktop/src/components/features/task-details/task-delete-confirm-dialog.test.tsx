import { describe, expect, test } from "bun:test";
import { formatManagedSessionCleanupMessage } from "./task-delete-confirm-dialog";

describe("TaskDeleteConfirmDialog", () => {
  test("mentions worktree and related branch cleanup when managed sessions exist", () => {
    const message = formatManagedSessionCleanupMessage(2);

    expect(message).toContain("2 linked task worktrees");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });

  test("omits worktree cleanup copy when no managed worktrees exist", () => {
    const message = formatManagedSessionCleanupMessage(1);

    expect(message).not.toContain("if they exist");
  });

  test("falls back to a conservative warning when cleanup impact is unknown", () => {
    const message = formatManagedSessionCleanupMessage(0);

    expect(message).toContain("will also be deleted if they exist");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });
});
