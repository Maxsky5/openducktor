import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createGitConflictActionsModel } from "./git-conflict-actions-model";
import { GitConflictDialog } from "./git-conflict-dialog";

test.each(["", "origin/main"])(
  "conflict dialog formats only a known target: %s",
  (targetBranch) => {
    const view = render(
      <GitConflictDialog
        open
        onOpenChange={() => {}}
        conflict={{
          operation: "rebase",
          currentBranch: "feature",
          targetBranch,
          conflictedFiles: ["conflict.txt"],
          output: "Conflict in conflict.txt",
          workingDir: "/repo",
        }}
        actions={createGitConflictActionsModel({
          operation: "rebase",
          isHandlingConflict: false,
          conflictAction: null,
          onAbort: () => {},
          onAsk: () => {},
          recipientLabel: "agent",
        })}
      />,
    );
    try {
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain(
        targetBranch
          ? "The rebase onto origin/main stopped on conflicts."
          : "The rebase stopped on conflicts.",
      );
      expect(dialog.querySelector("code")?.textContent ?? null).toBe(targetBranch || null);
      expect(dialog.textContent).toContain("send the conflict to agent for resolution.");
    } finally {
      view.unmount();
    }
  },
);
