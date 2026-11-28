import type { ArchiveFileDraft } from "@openducktor/frontend-core/operations/background-operation-store";
import { useCallback, useEffect, useRef } from "react";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

type PendingExit = { discarded: boolean; draft?: ArchiveFileDraft };

export function useWorkspaceSessionPreview(
  selectedFile: TaskExecutionSelectedFile | null,
  onSelectionChange: (selectedFile: TaskExecutionSelectedFile | null) => void,
  isWorktree: boolean,
  archiveDraft?: { readonly current: ArchiveFileDraft | null },
  discardArchiveDraft?: (draft: ArchiveFileDraft) => void,
) {
  const { register } = useWorkspacePreviewTransitionGuard();
  const isActive = useSessionViewActive();
  const preview = useTaskExecutionFilePreviewController(selectedFile);
  const pendingExitRef = useRef<PendingExit | null>(null);

  useEffect(
    () =>
      isActive
        ? register(
            (apply, cancel, options) => {
              if (isWorktree && options?.kind === "root_branch_switch") {
                void apply();
                return;
              }
              const pendingExit: PendingExit = { discarded: false };
              pendingExitRef.current = pendingExit;
              const finishExit = () => {
                if (pendingExit.draft) discardArchiveDraft?.(pendingExit.draft);
                onSelectionChange(pendingExit.discarded ? null : preview.model.selectedFile);
              };
              preview.requestContextTransition(
                () => {
                  if (options?.kind === "archive_chat") {
                    if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                    apply(pendingExit.draft);
                    // Consent only applies after a confirmed archive. Release the editor now.
                    return Promise.resolve(false);
                  }
                  if (options?.waitForSuccess) {
                    return Promise.resolve()
                      .then(async () => (await apply()) === true)
                      .then((switched) => {
                        if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                        if (switched) finishExit();
                        return switched;
                      })
                      .catch((error) => {
                        if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                        throw error;
                      });
                  }
                  if (pendingExitRef.current === pendingExit) pendingExitRef.current = null;
                  finishExit();
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
          )
        : undefined,
    [discardArchiveDraft, isActive, isWorktree, onSelectionChange, preview, register],
  );

  const onDiscard = useCallback(() => {
    if (!preview.model.hasPendingDiscard || preview.model.isApplyingTransition) return;
    const pendingExit = pendingExitRef.current;
    const draft = archiveDraft?.current;
    if (pendingExit) {
      pendingExit.discarded = true;
      if (draft) pendingExit.draft = draft;
    } else if (draft) {
      discardArchiveDraft?.(draft);
    }
    preview.model.onDiscard();
  }, [archiveDraft, discardArchiveDraft, preview.model]);

  return { preview, onDiscard };
}
