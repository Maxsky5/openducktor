import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
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

test("workspace close uses the standard layout and close-eye icon", () => {
  render(<WorkspaceCloseDialog workspace={workspace} onOpenChange={() => {}} />);

  const dialog = screen.getByRole("dialog", { name: "Close workspace" });
  expect(within(dialog).getByText("Hide OpenDucktor from the workspace rail?")).toBeTruthy();
  expect(within(dialog).getByText("/repos/openducktor")).toBeTruthy();

  const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
  const closeButton = within(dialog).getByRole("button", { name: "Close workspace" });
  expect(closeButton.querySelector(".lucide-eye-closed")).not.toBeNull();
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
  expect(
    within(dialog).getByText(
      "OpenDucktor will delete the workspace settings, all tasks, workflow documents, saved sessions, and managed attachments.",
    ),
  ).toBeTruthy();

  const removeButton = within(dialog).getByRole("button", { name: "Remove workspace" });
  expect(removeButton.querySelector(".lucide-trash-2")).not.toBeNull();
});
