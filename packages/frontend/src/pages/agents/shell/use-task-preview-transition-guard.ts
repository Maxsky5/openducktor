import { useEffect } from "react";
import type { UseTaskExecutionFilePreviewControllerResult } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";

/**
 * Protect unsaved task file edits when a session, workspace, page, or repository branch change
 * would unmount or replace the task content.
 *
 * A repository branch switch does not change a file in a task worktree, so it passes.
 */
export function useTaskPreviewTransitionGuard(
  preview: UseTaskExecutionFilePreviewControllerResult,
  workspaceRepoPath: string | null,
): void {
  const { register } = useWorkspacePreviewTransitionGuard();
  useEffect(
    () =>
      register(
        (apply, cancel, options) => {
          const selectedFile = preview.model.selectedFile;
          if (
            options?.kind === "root_branch_switch" &&
            selectedFile !== null &&
            selectedFile.rootPath !== workspaceRepoPath
          ) {
            void apply();
            return;
          }
          preview.requestContextTransition(
            apply,
            cancel,
            options?.waitForSuccess ? { waitForSuccess: true } : undefined,
          );
        },
        () => preview.model.onKeepEditing(),
      ),
    [preview, register, workspaceRepoPath],
  );
}
