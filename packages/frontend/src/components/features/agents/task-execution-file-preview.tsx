import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { memo, type ReactElement, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { workspaceTextFileQueryOptions } from "@/state/queries/filesystem";
import { TaskExecutionCodePreview } from "./task-execution-code-preview";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  previewSessionKey: number;
  preservePreviousSnapshot: boolean;
  onClose: () => void;
};

type FilePreviewSnapshot = {
  selectedFile: TaskExecutionSelectedFile;
  result: WorkspaceTextFileReadResult;
};
type CommittedFilePreviewSnapshot = {
  sessionKey: number;
  snapshot: FilePreviewSnapshot;
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
  const [committedSnapshot, setCommittedSnapshot] = useState<CommittedFilePreviewSnapshot | null>(
    null,
  );
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
  const retainedSnapshot =
    committedSnapshot?.sessionKey === model.previewSessionKey ? committedSnapshot.snapshot : null;
  const visibleSnapshot =
    currentSnapshot ?? (model.preservePreviousSnapshot ? retainedSnapshot : null);
  const isSwitchingFiles =
    selectedFile !== null &&
    visibleSnapshot !== null &&
    (visibleSnapshot.selectedFile.rootPath !== selectedFile.rootPath ||
      visibleSnapshot.selectedFile.relativePath !== selectedFile.relativePath) &&
    fileQuery.isFetching;
  const codePreviewFileId =
    visibleSnapshot?.result.kind === "text"
      ? `${visibleSnapshot.selectedFile.rootPath}:${visibleSnapshot.selectedFile.relativePath}`
      : null;
  const codePreviewRenderKey =
    codePreviewFileId !== null ? `${model.previewSessionKey}:${codePreviewFileId}` : null;

  useLayoutEffect(() => {
    if (!selectedFile) {
      setCommittedSnapshot(null);
      return;
    }
    if (currentSnapshot) {
      setCommittedSnapshot((previous) => {
        if (
          previous?.sessionKey === model.previewSessionKey &&
          previous.snapshot.result === currentSnapshot.result &&
          previous.snapshot.selectedFile.rootPath === currentSnapshot.selectedFile.rootPath &&
          previous.snapshot.selectedFile.relativePath === currentSnapshot.selectedFile.relativePath
        ) {
          return previous;
        }
        return { sessionKey: model.previewSessionKey, snapshot: currentSnapshot };
      });
    }
  }, [currentSnapshot, model.previewSessionKey, selectedFile]);

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
  } else if (visibleSnapshot?.result.kind === "text" && codePreviewFileId) {
    body = (
      <TaskExecutionCodePreview
        key={codePreviewRenderKey}
        className="h-full min-h-0"
        contents={visibleSnapshot.result.contents}
        fileName={visibleSnapshot.selectedFile.relativePath}
        theme={theme}
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
