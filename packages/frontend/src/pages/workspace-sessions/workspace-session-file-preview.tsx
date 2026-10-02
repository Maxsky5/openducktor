import { type Ref, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import {
  TaskExecutionSelectedFilePreview,
  type TaskExecutionFilePreviewLeavePolicy,
} from "@/components/features/agents/task-execution-file-preview";
import {
  taskExecutionSelectedFileKey,
  type TaskExecutionSelectedFile,
  type TaskExecutionFileSelectionResult,
} from "@/components/features/agents/task-execution-file-explorer-model";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import type { ReactNode } from "react";
import type { useWorkspaceSessionBranch } from "./use-workspace-session-branch";
import { useWorkspaceSessionPreview } from "./use-workspace-session-preview";

export type WorkspaceSessionFilePreviewHandle = {
  onSelectFile: (file: TaskExecutionSelectedFile) => TaskExecutionFileSelectionResult;
};

/** A session owns its file draft and pending exit actions. */
export function WorkspaceSessionFilePreview({
  ref,
  initialFile,
  onSelectionChange,
  onSafeToLeave,
  isWorktree,
  branch,
  hasRootBranch,
  onFileSaved,
}: {
  ref: Ref<WorkspaceSessionFilePreviewHandle>;
  initialFile: TaskExecutionSelectedFile | null;
  onSelectionChange: (file: TaskExecutionSelectedFile | null) => void;
  onSafeToLeave: (() => void) | undefined;
  isWorktree: boolean;
  branch: ReturnType<typeof useWorkspaceSessionBranch>;
  hasRootBranch: boolean;
  onFileSaved: () => void;
}) {
  const { preview, onLeavePolicyChange, closePreview, keepEditing, discardDraft } =
    useWorkspaceSessionFilePreview({ initialFile, onSelectionChange, isWorktree, onSafeToLeave });
  const { rootBranch, worktreeBranch, previewBranch, refreshBranch } = branch;
  useImperativeHandle(
    ref,
    () => ({
      onSelectFile: (file) =>
        preview.model.isApplyingTransition ? false : preview.onSelectFile(file),
    }),
    [preview],
  );
  useLayoutEffect(() => {
    onSelectionChange(preview.model.selectedFile);
  }, [onSelectionChange, preview.model.selectedFile]);
  if (!preview.model.selectedFile) return null;
  const filePreview = (
    <div className="h-full min-h-0" inert={preview.model.isApplyingTransition}>
      <TaskExecutionSelectedFilePreview
        key={preview.model.previewSessionKey}
        model={{
          ...preview.model,
          onClose: closePreview,
          onKeepEditing: keepEditing,
          onDiscard: discardDraft,
          onLeavePolicyChange,
        }}
        branch={previewBranch}
        requireBranch
        onFileSaved={onFileSaved}
      />
    </div>
  );
  const previewContent = isWorktree ? (
    <div className="flex h-full min-h-0 flex-col">
      {worktreeBranch.isError ? (
        <div role="alert" className="flex items-center gap-2 border-b border-border p-2 text-sm">
          <span className="min-w-0 flex-1 text-destructive">
            Could not read worktree branch: {errorMessage(worktreeBranch.error)}
          </span>
          <Button size="sm" variant="outline" onClick={() => void worktreeBranch.refetch()}>
            Retry branch
          </Button>
        </div>
      ) : null}
      {worktreeBranch.data ? (
        <div className="min-h-0 flex-1">{filePreview}</div>
      ) : !worktreeBranch.isError ? (
        <p role="status" className="p-3 text-sm">
          Checking worktree branch…
        </p>
      ) : null}
    </div>
  ) : (
    <RepositoryFilePreview
      hasBranch={hasRootBranch}
      isError={rootBranch.isError}
      error={rootBranch.error}
      onRetry={refreshBranch}
    >
      {filePreview}
    </RepositoryFilePreview>
  );
  return (
    <div
      className="absolute inset-0 z-10 h-full min-h-0 overflow-hidden"
      data-testid="workspace-session-file-preview"
    >
      {previewContent}
    </div>
  );
}

function useWorkspaceSessionFilePreview({
  initialFile,
  onSelectionChange,
  isWorktree,
  onSafeToLeave,
}: {
  initialFile: TaskExecutionSelectedFile | null;
  onSelectionChange: (file: TaskExecutionSelectedFile | null) => void;
  isWorktree: boolean;
  onSafeToLeave: (() => void) | undefined;
}) {
  const { preview, onDiscard } = useWorkspaceSessionPreview(
    initialFile,
    onSelectionChange,
    isWorktree,
  );
  const canLeaveRef = useRef(true);
  // Discard can finish a file switch too; only a close may release a removed chat.
  const closingRef = useRef(false);
  // A new file starts clean, but its editor does not report that on load.
  const selectedFileKey = preview.model.selectedFile
    ? taskExecutionSelectedFileKey(preview.model.selectedFile)
    : null;
  const selectedFileKeyRef = useRef(selectedFileKey);
  useLayoutEffect(() => {
    if (selectedFileKeyRef.current === selectedFileKey) return;
    selectedFileKeyRef.current = selectedFileKey;
    canLeaveRef.current = true;
    closingRef.current = false;
  }, [selectedFileKey]);
  const reportLeavePolicy = preview.model.onLeavePolicyChange;
  const closeFile = preview.model.onClose;
  const keepDraft = preview.model.onKeepEditing;
  const onLeavePolicyChange = useCallback(
    (policy: TaskExecutionFilePreviewLeavePolicy) => {
      reportLeavePolicy(policy);
      canLeaveRef.current = policy === "allow";
      if (canLeaveRef.current) {
        closingRef.current = false;
        onSafeToLeave?.();
      }
    },
    [onSafeToLeave, reportLeavePolicy],
  );
  const closePreview = useCallback(() => {
    closingRef.current = !canLeaveRef.current;
    closeFile();
    if (canLeaveRef.current) onSafeToLeave?.();
  }, [closeFile, onSafeToLeave]);
  const keepEditing = useCallback(() => {
    closingRef.current = false;
    keepDraft();
  }, [keepDraft]);
  const discardDraft = useCallback(() => {
    const closing = closingRef.current;
    closingRef.current = false;
    onDiscard();
    if (closing) onSafeToLeave?.();
  }, [onDiscard, onSafeToLeave]);
  return { preview, onLeavePolicyChange, closePreview, keepEditing, discardDraft };
}

function RepositoryFilePreview({
  hasBranch,
  isError,
  error,
  onRetry,
  children,
}: {
  hasBranch: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {isError ? (
        <div role="alert" className="flex items-center gap-2 border-b border-border p-2 text-sm">
          <span className="min-w-0 flex-1 text-destructive">
            Could not read repository branch: {errorMessage(error)}
          </span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry branch
          </Button>
        </div>
      ) : null}
      {hasBranch ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : !isError ? (
        <p role="status" className="p-3 text-sm">
          Checking repository branch…
        </p>
      ) : null}
    </div>
  );
}
