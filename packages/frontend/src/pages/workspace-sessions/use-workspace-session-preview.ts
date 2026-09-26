import { useCallback, useEffect, useRef } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";

export function useWorkspaceSessionPreview(
  selectedFile: TaskExecutionSelectedFile | null,
  onSelectionChange: (selectedFile: TaskExecutionSelectedFile | null) => void,
) {
  const { register } = useWorkspacePreviewTransitionGuard();
  const preview = useTaskExecutionFilePreviewController(selectedFile);
  const pendingExitRef = useRef<{ discarded: boolean } | null>(null);

  useEffect(
    () =>
      register(
        (apply, cancel, options) => {
          const pendingExit = { discarded: false };
          pendingExitRef.current = pendingExit;
          preview.requestContextTransition(
            () => {
              if (options?.waitForSuccess) {
                return Promise.resolve()
                  .then(async () => (await apply()) === true)
                  .then((switched) => {
                    if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                    if (switched)
                      onSelectionChange(pendingExit.discarded ? null : preview.model.selectedFile);
                    return switched;
                  })
                  .catch((error) => {
                    if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                    throw error;
                  });
              }
              if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
              onSelectionChange(pendingExit.discarded ? null : preview.model.selectedFile);
              apply();
            },
            () => {
              if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
              cancel?.();
            },
            options,
          );
        },
        () => {
          if (pendingExitRef.current) preview.model.onKeepEditing();
        },
      ),
    [onSelectionChange, preview, register],
  );

  const onDiscard = useCallback(() => {
    if (pendingExitRef.current) pendingExitRef.current.discarded = true;
    preview.model.onDiscard();
  }, [preview.model]);

  return { preview, onDiscard };
}
