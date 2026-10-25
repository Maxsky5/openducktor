import { useEffect } from "react";
import type { UseTaskExecutionFilePreviewControllerResult } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

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
  const isActive = useSessionViewActive();
  useEffect(
    () =>
      isActive
        ? register(
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
          )
        : undefined,
    [isActive, preview, register, workspaceRepoPath],
  );
}
