import { expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { GitConflictActions } from "./git-conflict-actions";
import { createGitConflictActionsModel } from "./git-conflict-actions-model";

test.each([
  ["light", "Builder"],
  ["light", "agent"],
  ["dark", "Builder"],
  ["dark", "agent"],
] as const)("%s %s assistance blockers retain the abort control", (theme, recipientLabel) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const abort = mock(() => {});
  const view = render(
    <GitConflictActions
      abortTestId="abort-conflict"
      askBuilderTestId="ask-agent"
      actions={createGitConflictActionsModel({
        operation: "pull_rebase",
        isHandlingConflict: false,
        conflictAction: null,
        onAbort: abort,
        onAsk: () => {},
        recipientLabel,
        blockedReason: "Answer the blocking question first.",
      })}
    />,
  );
  try {
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Resolve conflicts" }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Abort rebase" }).disabled).toBe(
      false,
    );
    expect(screen.getByRole("status").textContent).toBe("Answer the blocking question first.");
  } finally {
    view.unmount();
    document.documentElement.classList.remove("dark");
  }
});
