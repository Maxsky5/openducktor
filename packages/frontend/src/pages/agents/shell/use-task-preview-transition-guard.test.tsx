import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import {
  useWorkspacePreviewTransitionGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { useTaskPreviewTransitionGuard } from "./use-task-preview-transition-guard";

function TaskPreview({
  rootPath,
  onLeave,
}: {
  rootPath: string;
  onLeave: () => void;
}): ReactElement {
  const preview = useTaskExecutionFilePreviewController({ rootPath, relativePath: "draft.ts" });
  useTaskPreviewTransitionGuard(preview, "/repo");
  const { run } = useWorkspacePreviewTransitionGuard();
  return (
    <>
      <button type="button" onClick={() => preview.model.onLeavePolicyChange("confirm")}>
        Edit draft
      </button>
      <button type="button" onClick={() => run(onLeave)}>
        Open another session
      </button>
      <button type="button" onClick={() => run(onLeave, undefined, { kind: "root_branch_switch" })}>
        Switch repository branch
      </button>
      {preview.model.hasPendingDiscard ? (
        <button type="button" onClick={preview.model.onDiscard}>
          Discard draft
        </button>
      ) : null}
    </>
  );
}

const renderTaskPreview = (rootPath: string, onLeave: () => void) =>
  render(
    <WorkspacePreviewTransitionGuardProvider>
      <TaskPreview rootPath={rootPath} onLeave={onLeave} />
    </WorkspacePreviewTransitionGuardProvider>,
  );

test("asks before another session replaces a dirty task file", () => {
  const onLeave = mock(() => {});
  renderTaskPreview("/repo", onLeave);

  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Open another session" }));

  expect(onLeave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(onLeave).toHaveBeenCalledTimes(1);
});

test("lets a repository branch switch pass a dirty worktree file but not a repository file", () => {
  const worktreeLeave = mock(() => {});
  const worktree = renderTaskPreview("/worktrees/task-1", worktreeLeave);
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch repository branch" }));
  expect(worktreeLeave).toHaveBeenCalledTimes(1);
  worktree.unmount();

  const repositoryLeave = mock(() => {});
  renderTaskPreview("/repo", repositoryLeave);
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch repository branch" }));
  expect(repositoryLeave).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Discard draft" })).toBeTruthy();
});
