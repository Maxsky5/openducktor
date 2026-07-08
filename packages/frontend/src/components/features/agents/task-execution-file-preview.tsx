import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import type { CodeViewFileItem, CodeViewOptions, FileContents } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { type CSSProperties, memo, type ReactElement, useEffect, useMemo, useRef } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { workspaceTextFileQueryOptions } from "@/state/queries/filesystem";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  onClose: () => void;
};

const CODE_VIEW_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const CODE_VIEW_LINE_HEIGHT = 18;
const CODE_VIEW_CONTENT_PADDING = 8;
const CODE_VIEW_BACKGROUND_COLOR =
  "light-dark(var(--diffs-light-bg, #fff), var(--diffs-dark-bg, #000))";
const CODE_VIEW_ROOT_BASE_STYLE = {
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

[data-line-number-content] {
  min-width: 2ch;
}
`;

type FilePreviewSnapshot = {
  selectedFile: TaskExecutionSelectedFile;
  result: WorkspaceTextFileReadResult;
};

const contentHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
  model,
}: {
  model: TaskExecutionSelectedFilePreviewModel;
}): ReactElement | null {
  const selectedFile = model.selectedFile;
  const committedSnapshotRef = useRef<FilePreviewSnapshot | null>(null);
  const committedSnapshotSessionKeyRef = useRef(model.previewSessionKey);
  if (committedSnapshotSessionKeyRef.current !== model.previewSessionKey) {
    committedSnapshotSessionKeyRef.current = model.previewSessionKey;
    committedSnapshotRef.current = null;
  }
  const fileQuery = useQuery({
    ...workspaceTextFileQueryOptions(
      selectedFile?.rootPath ?? "__inactive_file_preview__",
      selectedFile?.relativePath ?? "__inactive_file_preview__",
    ),
    enabled: selectedFile !== null,
  });
  const { theme } = useTheme();
  const currentSnapshot = useMemo<FilePreviewSnapshot | null>(() => {
    if (!selectedFile || !resultBelongsToSelectedFile(fileQuery.data, selectedFile)) {
      return null;
    }
    return {
      selectedFile,
      result: fileQuery.data,
    };
  }, [fileQuery.data, selectedFile]);
  if (!selectedFile) {
    committedSnapshotRef.current = null;
  } else if (currentSnapshot) {
    committedSnapshotRef.current = currentSnapshot;
  }
  const visibleSnapshot = currentSnapshot ?? committedSnapshotRef.current;
  const isSwitchingFiles =
    selectedFile !== null &&
    visibleSnapshot !== null &&
    (visibleSnapshot.selectedFile.rootPath !== selectedFile.rootPath ||
      visibleSnapshot.selectedFile.relativePath !== selectedFile.relativePath) &&
    fileQuery.isFetching;
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
      backgroundColor: CODE_VIEW_BACKGROUND_COLOR,
      colorScheme: theme,
    }),
    [theme],
  );
  const codeViewFileId =
    visibleSnapshot?.result.kind === "text"
      ? `${visibleSnapshot.selectedFile.rootPath}:${visibleSnapshot.selectedFile.relativePath}`
      : null;
  const codeViewRenderKey =
    codeViewFileId !== null ? `${model.previewSessionKey}:${codeViewFileId}` : null;
  const codeViewItems = useMemo<CodeViewFileItem[]>(() => {
    if (visibleSnapshot?.result.kind !== "text" || !codeViewFileId) {
      return [];
    }

    const file: FileContents = {
      name: visibleSnapshot.selectedFile.relativePath,
      contents: visibleSnapshot.result.contents,
      cacheKey: `${codeViewFileId}:${visibleSnapshot.result.size}:${contentHash(visibleSnapshot.result.contents)}`,
    };

    return [
      {
        id: codeViewFileId,
        type: "file",
        file,
      },
    ];
  }, [codeViewFileId, visibleSnapshot]);

  useEffect(() => {
    if (!selectedFile) {
      return undefined;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      model.onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [model.onClose, selectedFile]);

  if (!selectedFile) {
    return null;
  }

  let body: ReactElement;
  if (fileQuery.isLoading && !visibleSnapshot) {
    body = <FilePreviewState message="Loading file..." />;
  } else if (fileQuery.isError) {
    body = <FilePreviewState message={errorMessage(fileQuery.error)} />;
  } else if (visibleSnapshot?.result.kind === "unsupported") {
    body = <FilePreviewState message={visibleSnapshot.result.message} />;
  } else if (codeViewFileId && codeViewItems.length > 0) {
    body = (
      <CodeView
        key={codeViewRenderKey}
        className="h-full min-h-0 overflow-auto"
        style={codeViewRootStyle}
        items={codeViewItems}
        options={codeViewOptions}
      />
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Close file preview"
          onClick={model.onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </section>
  );
});
