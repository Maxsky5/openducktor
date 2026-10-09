import { describe, expect, mock, test } from "bun:test";
import type { RepoAction, RepoActions } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RepoActionsSplitButton } from "./repo-actions-split-button";

const action = (id: string, name: string, icon: RepoAction["icon"]): RepoAction => ({
  id,
  icon,
  name,
  command: `bun run ${id}`,
  runOnWorktreeCreate: false,
  waitBeforeAgentStart: false,
});

const renderButton = (actions: RepoActions, disabledReason: string | null = null) => {
  const onRunAction = mock((_action: RepoAction) => {});
  const onManageActions = mock(() => {});
  const view = render(
    <TooltipProvider>
      <RepoActionsSplitButton
        actions={actions}
        disabledReason={disabledReason}
        onRunAction={onRunAction}
        onManageActions={onManageActions}
      />
    </TooltipProvider>,
  );
  return { view, onRunAction, onManageActions };
};

describe("RepoActionsSplitButton", () => {
  test("runs the default action and lists the other actions in order before Manage actions", async () => {
    const setup = action("setup", "Install", "configure");
    const tests = action("test", "Test", "test");
    const lint = action("lint", "Lint", "lint");
    const { onRunAction, onManageActions } = renderButton({
      items: [setup, tests, lint],
      defaultActionId: "test",
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Run Test" }));
      expect(onRunAction).toHaveBeenCalledWith(tests);

      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      const menu = await screen.findByRole("dialog", { name: "Repository actions" });
      expect(
        within(menu)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Install", "Lint", "Manage actions"]);

      fireEvent.click(within(menu).getByRole("button", { name: "Lint" }));
      expect(onRunAction).toHaveBeenLastCalledWith(lint);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 500 });

      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(await screen.findByRole("button", { name: "Manage actions" }));
      expect(onManageActions).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test("shows Add action when the repository has no actions", () => {
    const { onManageActions, onRunAction } = renderButton(
      { items: [], defaultActionId: null },
      "Task task-1 has no available worktree.",
    );
    try {
      const addAction = screen.getByRole("button", { name: "Add action" });
      expect(addAction.hasAttribute("disabled")).toBe(false);
      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();

      fireEvent.click(addAction);

      expect(onManageActions).toHaveBeenCalledTimes(1);
      expect(onRunAction).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test("shows an error that opens the actions settings when the default action is missing", async () => {
    const { onManageActions, onRunAction } = renderButton({
      items: [action("dev", "Dev", "play")],
      defaultActionId: "removed",
    });
    try {
      const fix = screen.getByRole("button", { name: /^Fix repository actions\./ });
      expect(screen.queryByRole("button", { name: "Run Dev" })).toBeNull();

      fireEvent.pointerMove(fix, { pointerType: "mouse" });
      await waitFor(
        () =>
          expect(screen.getByRole("tooltip").textContent).toBe(
            "The default action no longer exists. Choose a default action in the repository actions.",
          ),
        { timeout: 500 },
      );
      fireEvent.click(fix);

      expect(onManageActions).toHaveBeenCalledTimes(1);
      expect(onRunAction).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test("disables both parts and gives the reason when the session cannot run actions", async () => {
    const reason = "This chat is archived. Restore the chat to use terminals.";
    renderButton({ items: [action("dev", "Dev", "play")], defaultActionId: "dev" }, reason);
    try {
      const run = screen.getByRole("button", { name: "Run Dev" });
      expect(run.hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "More actions" }).hasAttribute("disabled")).toBe(
        true,
      );

      fireEvent.pointerMove(run.parentElement ?? run, { pointerType: "mouse" });

      await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(reason), {
        timeout: 500,
      });
    } finally {
      cleanup();
    }
  });
});
