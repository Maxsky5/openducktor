import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import {
  type CodeViewFileItem,
  type CodeViewOptions,
  type FileContents,
  getFiletypeFromFileName,
} from "@pierre/diffs";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import { CodeView, EditProvider, useWorkerPool } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, LoaderCircle, X } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
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
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import { useTaskExecutionFileEditor } from "./use-task-execution-file-editor";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  hasPendingDiscard: boolean;
  onClose: () => void;
  onEditStateChange(editState: { isDirty: boolean; isSaving: boolean }): void;
  onKeepEditing: () => void;
  onDiscard: () => void;
};

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

  const id = `${selectedFile.rootPath}:${selectedFile.relativePath}`;
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
        cacheKey: `${id}:${result.revision}`,
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
    onEditStateChange,
    onKeepEditing,
    onDiscard,
  },
}: {
  model: TaskExecutionSelectedFilePreviewModel;
}): ReactElement | null {
  const [committedSnapshot, setCommittedSnapshot] = useState<CommittedFilePreviewSnapshot | null>(
    null,
  );
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
    onEditStateChange,
  });
  const retainedSnapshot =
    committedSnapshot?.sessionKey === previewSessionKey ? committedSnapshot.snapshot : null;
  const currentEditorSnapshot = useMemo(() => {
    if (
      !selectedFile ||
      !editor.session ||
      editor.session.id !== `${selectedFile.rootPath}:${selectedFile.relativePath}`
    ) {
      return readyCurrentSnapshot;
    }
    return createFilePreviewSnapshot(selectedFile, editor.session.baseline);
  }, [editor.session, readyCurrentSnapshot, selectedFile]);
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
  const codeViewItems = useMemo<CodeViewFileItem[]>(() => {
    if (!visibleSnapshot?.codeViewFile || !codeViewFileId) {
      return [];
    }

    const isCurrentEditableItem =
      editor.session?.id === codeViewFileId &&
      readyCurrentSnapshot?.codeViewFile?.id === codeViewFileId &&
      !isSwitchingFiles;
    return [
      {
        id: codeViewFileId,
        type: "file",
        file: visibleSnapshot.codeViewFile.file,
        edit: isCurrentEditableItem,
        version: isCurrentEditableItem ? (editor.session?.version ?? 0) : 0,
      },
    ];
  }, [codeViewFileId, editor.session, isSwitchingFiles, readyCurrentSnapshot, visibleSnapshot]);
  const createEditor = useCallback(
    (options: EditorOptions<undefined>) => new Editor<undefined>(options),
    [],
  );
  const editorOptions = useMemo<EditorOptions<undefined>>(() => {
    const clipboard = getShellBridge().editorClipboard;
    return clipboard ? { clipboard } : {};
  }, []);
  const closePreview = useEffectEvent(onClose);

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

  useEffect(() => {
    if (!selectedFile) {
      return undefined;
    }

    const handlePreviewShortcut = (event: KeyboardEvent) => {
      const isSave = event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey);
      if (isSave && editor.session) {
        event.preventDefault();
        void editor.save();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented || hasPendingDiscard) {
        return;
      }
      event.preventDefault();
      closePreview();
    };

    window.addEventListener("keydown", handlePreviewShortcut);
    return () => window.removeEventListener("keydown", handlePreviewShortcut);
  }, [editor.save, editor.session, hasPendingDiscard, selectedFile]);

  if (!selectedFile) {
    return null;
  }

  let body: ReactElement;
  if (isFileError) {
    body = <FilePreviewState message={errorMessage(fileError)} />;
  } else if ((isFileLoading || !isCurrentSnapshotReady) && !visibleSnapshot) {
    body = <FilePreviewState message="Loading file..." />;
  } else if (visibleSnapshot?.result.kind === "unsupported") {
    body = <FilePreviewState message={visibleSnapshot.result.message} />;
  } else if (codeViewFileId && codeViewItems.length > 0) {
    body = (
      <EditProvider createEditor={createEditor}>
        <CodeView
          key={codeViewRenderKey}
          className={CODE_VIEW_CLASS_NAME}
          style={codeViewRootStyle}
          items={codeViewItems}
          options={codeViewOptions}
          editorOptions={editorOptions}
          onItemEditChange={editor.onItemEditChange}
        />
      </EditProvider>
    );
  } else {
    body = <FilePreviewState message="No file selected." />;
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Selected file preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {visibleSnapshot?.selectedFile.relativePath ?? selectedFile.relativePath}
        </div>
        {isSwitchingFiles ? (
          <div className="shrink-0 text-xs text-muted-foreground">Loading...</div>
        ) : null}
        {editor.session && !isSwitchingFiles ? (
          <>
            <div className="shrink-0 text-xs text-muted-foreground" role="status">
              {editor.isSaving ? "Saving..." : editor.isDirty ? "Unsaved" : "Saved"}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editor.isDirty || editor.isSaving}
              onClick={() => void editor.save()}
            >
              {editor.isSaving ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : null}
              Save
            </Button>
          </>
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
      {editor.saveError ? (
        <div
          className="shrink-0 border-b border-border px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {editor.saveError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
      <Dialog open={hasPendingDiscard} onOpenChange={(open) => !open && onKeepEditing()}>
        <DialogContent closeButton={null}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This file has unsaved changes. Keep editing or discard the draft to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onKeepEditing}>
              Keep editing
            </Button>
            <Button type="button" variant="destructive" onClick={onDiscard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
});
