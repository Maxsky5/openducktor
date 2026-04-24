import { describe, expect, test } from "bun:test";
import {
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-delete-confirm-dialog";

describe("TaskDeleteConfirmDialog", () => {
  test("mentions worktree and related branch cleanup when managed sessions exist", () => {
    const message = formatManagedSessionCleanupMessage(2);

    expect(message).toContain("2 linked task worktrees");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });

  test("uses exact-count wording when managed worktree count is known", () => {
    const message = formatManagedSessionCleanupMessage(1);

    expect(message).not.toContain("if they exist");
  });

  test("uses explicit unknown-impact wording when cleanup impact cannot be loaded", () => {
    const message = formatUnknownManagedSessionCleanupMessage();

    expect(message).toContain("may also be deleted");
    expect(message).toContain("related local branches");
    expect(message).toContain("uncommitted changes");
  });

  test("uses explicit loading wording while cleanup impact is still resolving", () => {
    const message = formatManagedSessionCleanupLoadingMessage();

    expect(message).toContain("Checking linked task worktree cleanup impact");
  });
});
