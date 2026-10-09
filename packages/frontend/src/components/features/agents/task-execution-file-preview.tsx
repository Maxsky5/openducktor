import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import { type FileContents, getFiletypeFromFileName } from "@pierre/diffs";
import type { Editor, EditorType } from "@pierre/diffs/edit";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, LoaderCircle, Save, X } from "lucide-react";
import {
  memo,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { workspaceTextFileQueryOptions } from "@/state/queries/filesystem";
import {
  isMarkdownFile,
  type TaskExecutionSelectedFile,
  taskExecutionSelectedFileKey,
} from "./task-execution-file-explorer-model";
import { useWorkerPool } from "./task-execution-file-preview-pierre";
import { FilePreviewBody, type FilePreviewSnapshot } from "./task-execution-file-preview-body";
import { useTaskExecutionFileEditor } from "./use-task-execution-file-editor";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  hasPendingDiscard: boolean;
  isApplyingTransition: boolean;
  onClose: () => void;
  onLeavePolicyChange(policy: TaskExecutionFilePreviewLeavePolicy): void;
  onKeepEditing: () => void;
  onDiscard: () => void;
};

export type TaskExecutionFilePreviewLeavePolicy = "allow" | "confirm" | "defer";

type TaskExecutionSelectedFilePreviewProps = {
  model: TaskExecutionSelectedFilePreviewModel;
  onFileSaved(): void;
  branch?: string | null;
  requireBranch?: boolean;
};

export const TaskExecutionSelectedFilePreview = memo(function TaskExecutionSelectedFilePreview({
  model: {
    selectedFile,
    previewSessionKey,
    preservePreviousSnapshot,
    hasPendingDiscard,
    isApplyingTransition,
    onClose,
    onLeavePolicyChange,
    onKeepEditing,
    onDiscard,
  },
  onFileSaved,
  branch = null,
  requireBranch = false,
}: TaskExecutionSelectedFilePreviewProps): ReactElement | null {
  const [committedSnapshot, setCommittedSnapshot] = useState<CommittedFilePreviewSnapshot | null>(
    null,
  );
  const attachedEditorRef = useRef<Editor<EditorType, undefined, undefined> | null>(null);
  const {
    data: fileData,
    error: fileError,
    isError: isFileError,
    isFetching: isFileFetching,
    isLoading: isFileLoading,
  } = useQuery({
    ...workspaceTextFileQueryOptions(
      selectedFile?.rootPath ?? "__inactive_file_preview__",
      selectedFile?.relativePath ?? "__inactive_file_preview__",
      undefined,
      selectedFile?.access,
    ),
    enabled: selectedFile !== null,
  });
  const currentSnapshot = useMemo<FilePreviewSnapshot | null>(() => {
    if (!selectedFile || !resultBelongsToSelectedFile(fileData, selectedFile)) {
      return null;
    }
    return createFilePreviewSnapshot(selectedFile, fileData);
  }, [fileData, selectedFile]);
  const isCurrentHighlightReady = useFileHighlightReady(
    currentSnapshot?.codeViewFile?.file ?? null,
  );
  const isCurrentSnapshotReady =
    currentSnapshot !== null && (currentSnapshot.codeViewFile === null || isCurrentHighlightReady);
  const readyCurrentSnapshot = isCurrentSnapshotReady ? currentSnapshot : null;
  const readyTextResult =
    readyCurrentSnapshot?.result.kind === "text" ? readyCurrentSnapshot.result : null;
  const editor = useTaskExecutionFileEditor({
    selectedFile,
    readyResult: readyTextResult,
    branch: selectedFile?.access === "local" ? null : branch,
    requireBranch: selectedFile?.access === "local" ? false : requireBranch,
    onFileSaved,
    onLeavePolicyChange,
  });
  const retainedSnapshot =
    committedSnapshot?.sessionKey === previewSessionKey ? committedSnapshot.snapshot : null;
  const currentEditorSnapshot = useMemo(
    () =>
      createEditorSnapshot({
        selectedFile,
        editor: { session: editor.session, isDirty: editor.isDirty, isSaving: editor.isSaving },
        isFileError,
        readyCurrentSnapshot,
        isCodeEditorAttached: attachedEditorRef.current !== null,
      }),
    [
      editor.isDirty,
      editor.isSaving,
      editor.session,
      isFileError,
      readyCurrentSnapshot,
      selectedFile,
    ],
  );
  const { visibleSnapshot, isSwitchingFiles, hasActiveEditorSession, message, readError } =
    resolveFilePreviewPresentation({
      selectedFile,
      currentEditorSnapshot,
      currentSnapshot,
      retainedSnapshot,
      preservePreviousSnapshot,
      isFileFetching,
      isCurrentSnapshotReady,
      editor,
      isFileError,
      isFileLoading,
      fileError,
    });
  useLayoutEffect(() => {
    if (!selectedFile) {
      setCommittedSnapshot(null);
      return;
    }
    if (isCurrentSnapshotReady && currentSnapshot) {
      setCommittedSnapshot((previous) => {
        if (
          previous?.sessionKey === previewSessionKey &&
          previous.snapshot.result === currentSnapshot.result &&
          previous.snapshot.selectedFile.rootPath === currentSnapshot.selectedFile.rootPath &&
          previous.snapshot.selectedFile.relativePath === currentSnapshot.selectedFile.relativePath
        ) {
          return previous;
        }
        return { sessionKey: previewSessionKey, snapshot: currentSnapshot };
      });
    }
  }, [currentSnapshot, isCurrentSnapshotReady, previewSessionKey, selectedFile]);

  const handlePreviewShortcut = useFilePreviewShortcut({
    editor,
    hasActiveEditorSession,
    hasPendingDiscard,
    onClose,
  });

  if (!selectedFile) {
    return null;
  }

  const displayedFile = visibleSnapshot?.selectedFile ?? selectedFile;
  const displayPath =
    displayedFile.access === "local"
      ? `${displayedFile.rootPath.replace(/\/$/, "")}/${displayedFile.relativePath}`
      : displayedFile.relativePath;
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-card"
      aria-label="Selected file preview"
      aria-busy={isSwitchingFiles}
      onKeyDown={handlePreviewShortcut}
    >
      <FilePreviewHeader
        relativePath={displayPath}
        saveState={resolveFilePreviewSaveState({
          hasSession: hasActiveEditorSession,
          isSwitchingFiles,
          isDirty: editor.isDirty,
          isSaving: editor.isSaving,
          hasStaleConflict: editor.hasStaleConflict,
        })}
        onSave={() => void editor.save()}
        onClose={onClose}
      />
      <FileErrorBanner
        saveError={editor.saveError}
        readError={readError}
        canReview={editor.canReviewConflict}
        isReviewingConflict={editor.isReviewingConflict}
        onReview={() => void editor.reviewLatestVersion()}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <FilePreviewBody
          snapshot={visibleSnapshot}
          message={message}
          previewSessionKey={previewSessionKey}
          editor={editor}
          editable={hasActiveEditorSession}
          hasPendingDiscard={hasPendingDiscard}
          editorRef={attachedEditorRef}
        />
      </div>
      <FileDiscardDialog
        open={hasPendingDiscard}
        isApplyingTransition={isApplyingTransition}
        onKeepEditing={onKeepEditing}
        onDiscard={onDiscard}
        onReturnFocus={() => attachedEditorRef.current?.focus({ preventScroll: true })}
      />
      <FileConflictReviewDialog
        result={editor.conflictReview}
        onClose={editor.closeConflictReview}
        onAccept={editor.acceptLatestBaseline}
        onReturnFocus={() => attachedEditorRef.current?.focus({ preventScroll: true })}
      />
    </section>
  );
});

const CODE_VIEW_NUMBER_COLUMN_PADDING = 1.25;
type CommittedFilePreviewSnapshot = {
  sessionKey: number;
  snapshot: FilePreviewSnapshot;
};

const numberColumnWidth = (value: string): string => {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode === 10) {
      lineCount += 1;
    }
  }
  return `${String(lineCount).length + CODE_VIEW_NUMBER_COLUMN_PADDING}ch`;
};

const createFilePreviewSnapshot = (
  selectedFile: TaskExecutionSelectedFile,
  result: WorkspaceTextFileReadResult,
): FilePreviewSnapshot => {
  if (result.kind !== "text" || isMarkdownFile(selectedFile.relativePath)) {
    return { selectedFile, result, codeViewFile: null };
  }

  const id = taskExecutionSelectedFileKey(selectedFile);
  const language = getFiletypeFromFileName(selectedFile.relativePath);
  return {
    selectedFile,
    result,
    codeViewFile: {
      id,
      file: {
        name: selectedFile.relativePath,
        contents: result.contents,
        lang: language,
        cacheKey: JSON.stringify([id, result.revision]),
      },
      numberColumnWidth: numberColumnWidth(result.contents),
    },
  };
};

const useFileHighlightReady = (file: FileContents | null): boolean => {
  const workerPool = useWorkerPool();
  const requiresHighlight = file !== null && file.lang !== "text";
  const subscribeToHighlightCache = useCallback(
    (onStoreChange: () => void) => {
      if (workerPool == null || file == null || !requiresHighlight) {
        return () => undefined;
      }
      return workerPool.subscribeToStatChanges(onStoreChange);
    },
    [file, requiresHighlight, workerPool],
  );
  const getHighlightCacheSnapshot = useCallback(
    () =>
      workerPool == null ||
      file == null ||
      !requiresHighlight ||
      workerPool.getFileResultCache(file) != null,
    [file, requiresHighlight, workerPool],
  );
  const isHighlightReady = useSyncExternalStore(
    subscribeToHighlightCache,
    getHighlightCacheSnapshot,
    () => false,
  );

  useEffect(() => {
    if (workerPool == null || file == null || !requiresHighlight || isHighlightReady) {
      return;
    }
    workerPool.primeFileHighlightCache(file);
  }, [file, isHighlightReady, requiresHighlight, workerPool]);

  return isHighlightReady;
};

function FileConflictReviewDialog({
  result,
  onClose,
  onAccept,
  onReturnFocus,
}: {
  result: Extract<WorkspaceTextFileReadResult, { kind: "text" }> | null;
  onClose: () => void;
  onAccept: () => void;
  onReturnFocus: () => void;
}): ReactElement {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Review latest file</DialogTitle>
          <DialogDescription>
            Review the latest contents below. Your draft stays unchanged.
          </DialogDescription>
        </DialogHeader>
        <section aria-label="Latest file contents">
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
            {result?.contents}
          </pre>
        </section>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Keep current baseline
          </Button>
          <Button type="button" onClick={onAccept}>
            Use latest as baseline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FilePreviewSaveState = "unavailable" | "clean" | "dirty" | "saving" | "blocked";

const resolveFilePreviewSaveState = ({
  hasSession,
  isSwitchingFiles,
  isDirty,
  isSaving,
  hasStaleConflict,
}: {
  hasSession: boolean;
  isSwitchingFiles: boolean;
  isDirty: boolean;
  isSaving: boolean;
  hasStaleConflict: boolean;
}): FilePreviewSaveState => {
  if (!hasSession || isSwitchingFiles) return "unavailable";
  if (isSaving) return "saving";
  if (!isDirty) return "clean";
  if (hasStaleConflict) return "blocked";
  return "dirty";
};

function FilePreviewHeader({
  relativePath,
  saveState,
  onSave,
  onClose,
}: {
  relativePath: string;
  saveState: FilePreviewSaveState;
  onSave: () => void;
  onClose: () => void;
}): ReactElement {
  const isAvailable = saveState !== "unavailable";
  const showsUnsavedIndicator = isAvailable && saveState !== "clean";
  const isSaving = saveState === "saving";
  const saveLabel = isSaving ? "Saving file" : "Save file";
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{relativePath}</span>
        {showsUnsavedIndicator ? (
          <span
            className="size-2 shrink-0 rounded-full bg-foreground"
            role="status"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          />
        ) : null}
      </div>
      {isAvailable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={saveLabel}
          aria-busy={isSaving || undefined}
          title={saveLabel}
          disabled={saveState !== "dirty"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onSave}
        >
          <Save />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label="Close file preview"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function FileErrorBanner({
  saveError,
  readError,
  canReview,
  isReviewingConflict,
  onReview,
}: {
  saveError: string | null;
  readError: string | null;
  canReview: boolean;
  isReviewingConflict: boolean;
  onReview: () => void;
}): ReactElement | null {
  if (!saveError && !readError) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      <div className="min-w-0 flex-1 space-y-1">
        {readError && readError !== saveError ? <p>{readError}</p> : null}
        {saveError ? <p>{saveError}</p> : null}
      </div>
      {canReview ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isReviewingConflict}
          onClick={onReview}
        >
          {isReviewingConflict ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : null}
          Review latest version
        </Button>
      ) : null}
    </div>
  );
}

function FileDiscardDialog({
  open,
  isApplyingTransition,
  onKeepEditing,
  onDiscard,
  onReturnFocus,
}: {
  open: boolean;
  isApplyingTransition: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onReturnFocus: () => void;
}): ReactElement {
  const shouldRestoreEditorFocusRef = useRef(false);
  const keepEditing = (): void => {
    shouldRestoreEditorFocusRef.current = true;
    onKeepEditing();
  };
  const discard = (): void => {
    shouldRestoreEditorFocusRef.current = false;
    onDiscard();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !isApplyingTransition && keepEditing()}
    >
      <DialogContent
        closeButton={null}
        onCloseAutoFocus={(event) => {
          if (!shouldRestoreEditorFocusRef.current) return;
          shouldRestoreEditorFocusRef.current = false;
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            This file has unsaved changes. Keep editing or discard the draft to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isApplyingTransition}
            onClick={keepEditing}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isApplyingTransition}
            onClick={discard}
          >
            {isApplyingTransition ? "Working..." : "Discard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const resultBelongsToSelectedFile = (
  result: WorkspaceTextFileReadResult | undefined,
  selectedFile: TaskExecutionSelectedFile | null,
): result is WorkspaceTextFileReadResult => {
  if (!result || !selectedFile) {
    return false;
  }
  return (
    result.rootPath === selectedFile.rootPath && result.relativePath === selectedFile.relativePath
  );
};

type FilePreviewPresentation = {
  visibleSnapshot: FilePreviewSnapshot | null;
  isSwitchingFiles: boolean;
  hasActiveEditorSession: boolean;
  message: string | null;
  readError: string | null;
};

function resolveFilePreviewPresentation({
  selectedFile,
  currentEditorSnapshot,
  currentSnapshot,
  retainedSnapshot,
  preservePreviousSnapshot,
  isFileFetching,
  isCurrentSnapshotReady,
  editor,
  isFileError,
  isFileLoading,
  fileError,
}: {
  selectedFile: TaskExecutionSelectedFile | null;
  currentEditorSnapshot: FilePreviewSnapshot | null;
  currentSnapshot: FilePreviewSnapshot | null;
  retainedSnapshot: FilePreviewSnapshot | null;
  preservePreviousSnapshot: boolean;
  isFileFetching: boolean;
  isCurrentSnapshotReady: boolean;
  editor: Pick<ReturnType<typeof useTaskExecutionFileEditor>, "session" | "isDirty" | "isSaving">;
  isFileError: boolean;
  isFileLoading: boolean;
  fileError: unknown;
}): FilePreviewPresentation {
  const visibleSnapshot =
    currentEditorSnapshot ?? (preservePreviousSnapshot ? retainedSnapshot : null);
  const isSwitchingFiles =
    selectedFile !== null &&
    visibleSnapshot !== null &&
    (visibleSnapshot.selectedFile.rootPath !== selectedFile.rootPath ||
      visibleSnapshot.selectedFile.relativePath !== selectedFile.relativePath ||
      visibleSnapshot.selectedFile.access !== selectedFile.access) &&
    (isFileFetching || (!isFileError && !isCurrentSnapshotReady));
  const fileId =
    visibleSnapshot?.result.kind === "text"
      ? taskExecutionSelectedFileKey(visibleSnapshot.selectedFile)
      : null;
  const hasActiveEditorSession =
    fileId !== null &&
    editor.session?.id === fileId &&
    !isSwitchingFiles &&
    (!isFileError || editor.isDirty || editor.isSaving);

  let message: string | null = null;
  if (isFileError && !hasActiveEditorSession) {
    message = errorMessage(fileError);
  } else if ((isFileLoading || !isCurrentSnapshotReady) && !visibleSnapshot) {
    message = "Loading file...";
  } else if (visibleSnapshot?.result.kind === "unsupported") {
    message = visibleSnapshot.result.message;
  }
  let readError: string | null = null;
  if (hasActiveEditorSession) {
    if (isFileError) readError = errorMessage(fileError);
    else if (currentSnapshot?.result.kind === "unsupported")
      readError = currentSnapshot.result.message;
  }
  return {
    visibleSnapshot,
    isSwitchingFiles,
    hasActiveEditorSession,
    message,
    readError,
  };
}

function createEditorSnapshot({
  selectedFile,
  editor,
  isFileError,
  readyCurrentSnapshot,
  isCodeEditorAttached,
}: {
  selectedFile: TaskExecutionSelectedFile | null;
  editor: Pick<ReturnType<typeof useTaskExecutionFileEditor>, "session" | "isDirty" | "isSaving">;
  isFileError: boolean;
  readyCurrentSnapshot: FilePreviewSnapshot | null;
  isCodeEditorAttached: boolean;
}): FilePreviewSnapshot | null {
  if (
    !selectedFile ||
    !editor.session ||
    editor.session.id !== taskExecutionSelectedFileKey(selectedFile)
  ) {
    return readyCurrentSnapshot;
  }
  const mustKeepDraft = editor.isDirty || editor.isSaving;
  const cannotEdit =
    isFileError || (readyCurrentSnapshot !== null && readyCurrentSnapshot.result.kind !== "text");
  if (!mustKeepDraft && cannotEdit) {
    return readyCurrentSnapshot;
  }
  const result =
    isCodeEditorAttached || isMarkdownFile(selectedFile.relativePath)
      ? editor.session.source
      : editor.session.baseline;
  return createFilePreviewSnapshot(selectedFile, result);
}

function useFilePreviewShortcut({
  editor,
  hasActiveEditorSession,
  hasPendingDiscard,
  onClose,
}: {
  editor: Pick<
    ReturnType<typeof useTaskExecutionFileEditor>,
    "hasStaleConflict" | "isDirty" | "isSaving" | "save"
  >;
  hasActiveEditorSession: boolean;
  hasPendingDiscard: boolean;
  onClose(): void;
}): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const { hasStaleConflict, isDirty, isSaving, save } = editor;
  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const isSave = event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey);
      if (isSave) {
        event.preventDefault();
        if (hasPendingDiscard) return;
        const canSave = hasActiveEditorSession && isDirty && !isSaving && !hasStaleConflict;
        if (canSave) {
          void save();
        }
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented || hasPendingDiscard) {
        return;
      }
      event.preventDefault();
      onClose();
    },
    [hasStaleConflict, hasActiveEditorSession, hasPendingDiscard, isDirty, isSaving, onClose, save],
  );
}
