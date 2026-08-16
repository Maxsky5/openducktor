import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import {
  type CodeViewFileItem,
  type CodeViewOptions,
  type FileContents,
  getFiletypeFromFileName,
} from "@pierre/diffs";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, LoaderCircle, Save, X } from "lucide-react";
import {
  type CSSProperties,
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
import { useTheme } from "@/components/layout/theme-provider";
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
import { getShellBridge } from "@/lib/shell-bridge";
import { workspaceTextFileQueryOptions } from "@/state/queries/filesystem";
import {
  type TaskExecutionSelectedFile,
  taskExecutionSelectedFileKey,
} from "./task-execution-file-explorer-model";
import { CodeView, EditProvider, useWorkerPool } from "./task-execution-file-preview-pierre";
import { useTaskExecutionFileEditor } from "./use-task-execution-file-editor";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  hasPendingDiscard: boolean;
  onClose: () => void;
  onLeavePolicyChange(policy: TaskExecutionFilePreviewLeavePolicy): void;
  onKeepEditing: () => void;
  onDiscard: () => void;
};

export type TaskExecutionFilePreviewLeavePolicy = "allow" | "confirm" | "defer";

const CODE_VIEW_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const CODE_VIEW_THEME_BACKGROUND = { dark: "#0a0a0a", light: "#ffffff" } as const;
const CODE_VIEW_DIFFS_BACKGROUND = "light-dark(var(--diffs-light-bg), var(--diffs-dark-bg))";
const CODE_VIEW_BACKGROUND_COLOR = "var(--diffs-bg)";
const CODE_VIEW_NUMBER_COLUMN_WIDTH = "var(--file-preview-number-column-width)";
const CODE_VIEW_LINE_HEIGHT = 18;
const CODE_VIEW_CONTENT_PADDING = 8;
const CODE_VIEW_NUMBER_COLUMN_PADDING = 1.25;
const CODE_VIEW_CLASS_NAME = "h-full min-h-0 overflow-auto";
const CODE_VIEW_ROOT_BASE_STYLE = {
  "--diffs-light-bg": CODE_VIEW_THEME_BACKGROUND.light,
  "--diffs-dark-bg": CODE_VIEW_THEME_BACKGROUND.dark,
  "--diffs-bg": CODE_VIEW_DIFFS_BACKGROUND,
  "--diffs-font-size": "12px",
  "--diffs-line-height": `${CODE_VIEW_LINE_HEIGHT}px`,
  "--diffs-gap-block": `${CODE_VIEW_CONTENT_PADDING}px`,
  "--diffs-scrollbar-gutter-override": "0px",
  "--diffs-tab-size": 2,
} as CSSProperties;

function EditorAttachmentLifecycle({
  children,
  onDetach,
}: {
  children: ReactElement;
  onDetach(): void;
}): ReactElement {
  useLayoutEffect(() => onDetach, [onDetach]);
  return children;
}
const CODE_VIEW_PREVIEW_UNSAFE_CSS = `
[data-column-number],
[data-gutter-buffer] {
  padding-left: 0.5ch;
  padding-right: 0.75ch;
}

[data-file] {
  --diffs-grid-number-column-width: ${CODE_VIEW_NUMBER_COLUMN_WIDTH};
}
`;

type PreparedCodeViewFile = {
  id: string;
  file: FileContents;
  numberColumnWidth: string;
};
type FilePreviewSnapshot = {
  selectedFile: TaskExecutionSelectedFile;
  result: WorkspaceTextFileReadResult;
  codeViewFile: PreparedCodeViewFile | null;
};
type CommittedFilePreviewSnapshot = {
  sessionKey: number;
  snapshot: FilePreviewSnapshot;
};

const getContentMetrics = (value: string): { numberColumnWidth: string } => {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode === 10) {
      lineCount += 1;
    }
  }
  const numberColumnWidth = String(lineCount).length + CODE_VIEW_NUMBER_COLUMN_PADDING;
  return {
    numberColumnWidth: `${numberColumnWidth}ch`,
  };
};

const createFilePreviewSnapshot = (
  selectedFile: TaskExecutionSelectedFile,
  result: WorkspaceTextFileReadResult,
): FilePreviewSnapshot => {
  if (result.kind !== "text") {
    return { selectedFile, result, codeViewFile: null };
  }

  const id = taskExecutionSelectedFileKey(selectedFile);
  const metrics = getContentMetrics(result.contents);
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
      numberColumnWidth: metrics.numberColumnWidth,
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

function FilePreviewState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function FileConflictReviewDialog({
  result,
  onClose,
  onAccept,
}: {
  result: Extract<WorkspaceTextFileReadResult, { kind: "text" }> | null;
  onClose: () => void;
  onAccept: () => void;
}): ReactElement {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review latest file</DialogTitle>
          <DialogDescription>
            This file changed outside OpenDucktor. Review the latest contents below. Your draft
            stays unchanged.
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
  isSwitchingFiles,
  saveState,
  onSave,
  onClose,
}: {
  relativePath: string;
  isSwitchingFiles: boolean;
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
      {isSwitchingFiles ? (
        <div className="shrink-0 text-xs text-muted-foreground">Loading...</div>
      ) : null}
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

function FileSaveErrorBanner({
  message,
  hasStaleConflict,
  isReviewingConflict,
  onReview,
}: {
  message: string | null;
  hasStaleConflict: boolean;
  isReviewingConflict: boolean;
  onReview: () => void;
}): ReactElement | null {
  if (!message) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {hasStaleConflict ? (
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
  onKeepEditing,
  onDiscard,
  onReturnFocus,
}: {
  open: boolean;
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
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && keepEditing()}>
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
          <Button type="button" variant="outline" onClick={keepEditing}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={discard}>
            Discard
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

export const TaskExecutionSelectedFilePreview = memo(function TaskExecutionSelectedFilePreview({
  model: {
    selectedFile,
    previewSessionKey,
    preservePreviousSnapshot,
    hasPendingDiscard,
    onClose,
    onLeavePolicyChange,
    onKeepEditing,
    onDiscard,
  },
  onFileSaved,
}: {
  model: TaskExecutionSelectedFilePreviewModel;
  onFileSaved(): void;
}): ReactElement | null {
  const [committedSnapshot, setCommittedSnapshot] = useState<CommittedFilePreviewSnapshot | null>(
    null,
  );
  const attachedEditorRef = useRef<Editor<undefined> | null>(null);
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
    ),
    enabled: selectedFile !== null,
  });
  const { theme } = useTheme();
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
    onFileSaved,
    onLeavePolicyChange,
  });
  const { hasStaleConflict, isDirty, isSaving, save } = editor;
  const retainedSnapshot =
    committedSnapshot?.sessionKey === previewSessionKey ? committedSnapshot.snapshot : null;
  const currentEditorSnapshot = useMemo(() => {
    if (
      !selectedFile ||
      !editor.session ||
      editor.session.id !== taskExecutionSelectedFileKey(selectedFile)
    ) {
      return readyCurrentSnapshot;
    }
    const mustKeepDraft = editor.isDirty || editor.isSaving;
    const refreshedFileCannotStayEditable =
      isFileError || readyCurrentSnapshot?.result.kind === "unsupported";
    if (!mustKeepDraft && refreshedFileCannotStayEditable) {
      return readyCurrentSnapshot;
    }
    const editorResult = attachedEditorRef.current
      ? editor.session.source
      : editor.session.baseline;
    return createFilePreviewSnapshot(selectedFile, editorResult);
  }, [
    editor.isDirty,
    editor.isSaving,
    editor.session,
    isFileError,
    readyCurrentSnapshot,
    selectedFile,
  ]);
  const visibleSnapshot =
    currentEditorSnapshot ?? (preservePreviousSnapshot ? retainedSnapshot : null);
  const isSwitchingFiles =
    selectedFile !== null &&
    visibleSnapshot !== null &&
    (visibleSnapshot.selectedFile.rootPath !== selectedFile.rootPath ||
      visibleSnapshot.selectedFile.relativePath !== selectedFile.relativePath) &&
    (isFileFetching || !isCurrentSnapshotReady);
  const codeViewOptions = useMemo<CodeViewOptions<undefined>>(
    () => ({
      theme: CODE_VIEW_THEME,
      themeType: theme,
      overflow: "wrap" as const,
      disableFileHeader: true,
      itemMetrics: {
        lineHeight: CODE_VIEW_LINE_HEIGHT,
        spacing: CODE_VIEW_CONTENT_PADDING,
        paddingTop: CODE_VIEW_CONTENT_PADDING,
        paddingBottom: CODE_VIEW_CONTENT_PADDING,
      },
      layout: {
        paddingTop: 0,
        paddingBottom: 0,
        gap: 0,
      },
      unsafeCSS: CODE_VIEW_PREVIEW_UNSAFE_CSS,
    }),
    [theme],
  );
  const codeViewRootStyle = useMemo<CSSProperties>(
    () => ({
      ...CODE_VIEW_ROOT_BASE_STYLE,
      "--file-preview-number-column-width":
        visibleSnapshot?.codeViewFile?.numberColumnWidth ?? "2.25ch",
      backgroundColor: CODE_VIEW_BACKGROUND_COLOR,
      colorScheme: theme,
    }),
    [theme, visibleSnapshot?.codeViewFile?.numberColumnWidth],
  );
  const codeViewFileId = visibleSnapshot?.codeViewFile?.id ?? null;
  const codeViewRenderKey =
    codeViewFileId !== null ? `${previewSessionKey}:${codeViewFileId}` : null;
  const handleEditorDetach = useCallback(() => {
    attachedEditorRef.current = null;
  }, []);
  const hasActiveEditorSession =
    codeViewFileId !== null &&
    editor.session?.id === codeViewFileId &&
    !isSwitchingFiles &&
    (!isFileError || editor.isDirty || editor.isSaving);
  const codeViewItems = useMemo<CodeViewFileItem[]>(() => {
    if (!visibleSnapshot?.codeViewFile || !codeViewFileId) {
      return [];
    }

    return [
      {
        id: codeViewFileId,
        type: "file",
        file: visibleSnapshot.codeViewFile.file,
        edit: hasActiveEditorSession,
        version: hasActiveEditorSession ? (editor.session?.version ?? 0) + 1 : 0,
      },
    ];
  }, [codeViewFileId, editor.session, hasActiveEditorSession, visibleSnapshot]);
  const createEditor = useCallback(
    (options: EditorOptions<undefined>) => new Editor<undefined>(options),
    [],
  );
  const editorOptions = useMemo<EditorOptions<undefined>>(() => {
    const clipboard = getShellBridge().editorClipboard;
    return {
      ...(clipboard ? { clipboard } : {}),
      onAttach(attachedEditor) {
        attachedEditorRef.current = attachedEditor;
        attachedEditor.focus({ lineNumber: "first-visible", preventScroll: true });
      },
    };
  }, []);

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

  const handlePreviewShortcut = useCallback(
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

  if (!selectedFile) {
    return null;
  }

  let body: ReactElement;
  if (isFileError && !hasActiveEditorSession) {
    body = <FilePreviewState message={errorMessage(fileError)} />;
  } else if ((isFileLoading || !isCurrentSnapshotReady) && !visibleSnapshot) {
    body = <FilePreviewState message="Loading file..." />;
  } else if (visibleSnapshot?.result.kind === "unsupported") {
    body = <FilePreviewState message={visibleSnapshot.result.message} />;
  } else if (codeViewFileId && codeViewItems.length > 0) {
    body = (
      <EditorAttachmentLifecycle key={codeViewRenderKey} onDetach={handleEditorDetach}>
        <EditProvider createEditor={createEditor}>
          <CodeView
            className={CODE_VIEW_CLASS_NAME}
            style={codeViewRootStyle}
            items={codeViewItems}
            options={codeViewOptions}
            editorOptions={editorOptions}
            onItemEditChange={editor.onItemEditChange}
          />
        </EditProvider>
      </EditorAttachmentLifecycle>
    );
  } else {
    body = <FilePreviewState message="No file selected." />;
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-card"
      aria-label="Selected file preview"
      onKeyDown={handlePreviewShortcut}
    >
      <FilePreviewHeader
        relativePath={visibleSnapshot?.selectedFile.relativePath ?? selectedFile.relativePath}
        isSwitchingFiles={isSwitchingFiles}
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
      <FileSaveErrorBanner
        message={editor.saveError}
        hasStaleConflict={editor.hasStaleConflict}
        isReviewingConflict={editor.isReviewingConflict}
        onReview={() => void editor.reviewLatestVersion()}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
      <FileDiscardDialog
        open={hasPendingDiscard}
        onKeepEditing={onKeepEditing}
        onDiscard={onDiscard}
        onReturnFocus={() => attachedEditorRef.current?.focus({ preventScroll: true })}
      />
      <FileConflictReviewDialog
        result={editor.conflictReview}
        onClose={editor.closeConflictReview}
        onAccept={editor.acceptLatestBaseline}
      />
    </section>
  );
});
