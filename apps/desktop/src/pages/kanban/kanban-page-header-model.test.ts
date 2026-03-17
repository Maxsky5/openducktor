import { describe, expect, test } from "bun:test";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";

describe("isKanbanTaskCreationDisabled", () => {
  test("disables task creation when no repository is active", () => {
    expect(isKanbanTaskCreationDisabled(null, null)).toBe(true);
  });

  test("disables task creation when beads is unavailable", () => {
    expect(
      isKanbanTaskCreationDisabled("/repo", {
        beadsOk: false,
        beadsPath: null,
        beadsError: "beads unavailable",
      }),
    ).toBe(true);
  });

  test("enables task creation when beads is ready", () => {
    expect(
      isKanbanTaskCreationDisabled("/repo", {
        beadsOk: true,
        beadsPath: "/tmp/beads",
        beadsError: null,
      }),
    ).toBe(false);
  });
});
