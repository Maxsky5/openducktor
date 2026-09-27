import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import * as appStateProvider from "@/state/app-state-provider";

enableReactActEnvironment();

const workspace: WorkspaceRecord = {
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repos/openducktor",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: "/worktrees",
  effectiveWorktreeBasePath: "/worktrees",
};

// SAFETY: These dialogs read only the two workspace actions in this test.
const workspaceState = Object.assign(Object.create(null), {
  closeWorkspace: async () => {},
  removeWorkspace: async () => {},
}) as ReturnType<typeof appStateProvider.useWorkspaceState>;
const workspaceStateSpy = spyOn(appStateProvider, "useWorkspaceState").mockReturnValue(
  workspaceState,
);
const { WorkspaceCloseDialog, WorkspaceRemoveDialog } =
  await import("./workspace-lifecycle-dialogs");

afterEach(cleanup);
afterAll(() => workspaceStateSpy.mockRestore());

test("workspace close uses the standard layout and eye-off icon", () => {
  render(<WorkspaceCloseDialog workspace={workspace} onOpenChange={() => {}} />);

  const dialog = screen.getByRole("dialog", { name: "Close workspace" });
  expect(within(dialog).getByText("Hide OpenDucktor from the workspace rail?")).toBeTruthy();
  expect(within(dialog).getByText("Repository")).toBeTruthy();
  expect(within(dialog).getByText("/repos/openducktor")).toBeTruthy();
  expect(within(dialog).getByText("Only the workspace rail entry is hidden.")).toBeTruthy();

  const repositoryIconSurface = dialog.querySelector(".lucide-folder-git-2")?.parentElement;
  const closeInfoIconSurface = within(dialog).getByText("Only the workspace rail entry is hidden.")
    .parentElement?.previousElementSibling;
  expect(repositoryIconSurface?.className).toContain("bg-muted");
  expect(repositoryIconSurface?.className).toContain("text-foreground");
  expect(closeInfoIconSurface?.className).toContain("bg-muted");
  expect(closeInfoIconSurface?.className).toContain("text-foreground");

  const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
  const closeButton = within(dialog).getByRole("button", { name: "Close workspace" });
  expect(closeButton.querySelector(".lucide-eye-off")).not.toBeNull();
  expect(closeButton.parentElement).toBe(cancelButton.parentElement);
  expect(closeButton.parentElement?.className).toContain("justify-between");
  expect(closeButton.parentElement?.className).toContain("border-t");
});

test("workspace removal uses the destructive layout and trash icon", () => {
  render(<WorkspaceRemoveDialog workspace={workspace} onOpenChange={() => {}} />);

  const dialog = screen.getByRole("dialog", { name: "Remove workspace" });
  expect(
    within(dialog).getByText(
      "Permanently remove OpenDucktor and its task data? This cannot be undone.",
    ),
  ).toBeTruthy();

  expect(within(dialog).getByText("Repository")).toBeTruthy();
  expect(within(dialog).getByText("/repos/openducktor")).toBeTruthy();
  const worktreeCheckbox = within(dialog).getByRole("checkbox", {
    name: "Remove task worktrees",
  });
  expect(worktreeCheckbox.className).toContain("size-5");
  expect(worktreeCheckbox.className).toContain("border-2");
  expect(worktreeCheckbox.parentElement?.className).toContain("items-center");
  expect(
    within(dialog).getByText(
      "OpenDucktor will delete the workspace settings, all tasks, workflow documents, saved sessions, and managed attachments.",
    ),
  ).toBeTruthy();

  const removeButton = within(dialog).getByRole("button", { name: "Remove workspace" });
  expect(removeButton.querySelector(".lucide-trash-2")).not.toBeNull();
});

test("workspace removal waits for one preview choice before it can run", () => {
  const remove = spyOn(workspaceState, "removeWorkspace");
  const onOpenChange = mock((_open: boolean) => {});
  const requests: Array<{ apply: () => void; cancel: () => void }> = [];
  try {
    render(
      <WorkspaceRemoveDialog
        workspace={workspace}
        onOpenChange={onOpenChange}
        requestTransition={(apply, cancel) =>
          requests.push({ apply, cancel: cancel ?? (() => {}) })
        }
      />,
    );

    const removeButton = screen.getByRole("button", { name: "Remove workspace" });
    fireEvent.click(removeButton);
    fireEvent.click(removeButton);

    expect(requests).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Waiting for file choice..." }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("checkbox", { name: "Remove task worktrees" }).closest("fieldset")?.disabled,
    ).toBe(true);

    act(() => requests[0]?.cancel());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(remove).not.toHaveBeenCalled();
  } finally {
    remove.mockRestore();
  }
});
