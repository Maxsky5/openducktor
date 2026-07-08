import type { CodeViewFileItem, FileContents } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, X } from "lucide-react";
import { type CSSProperties, memo, type ReactElement, useMemo } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { workspaceTextFileQueryOptions } from "@/state/queries/filesystem";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

export type TaskExecutionSelectedFilePreviewModel = {
  selectedFile: TaskExecutionSelectedFile | null;
  onClose: () => void;
};

const CODE_VIEW_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const CODE_VIEW_WRAPPER_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.5",
  "--diffs-tab-size": 2,
} as CSSProperties;

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
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export const TaskExecutionSelectedFilePreview = memo(function TaskExecutionSelectedFilePreview({
  model,
}: {
  model: TaskExecutionSelectedFilePreviewModel;
}): ReactElement | null {
  const selectedFile = model.selectedFile;
  const fileQuery = useQuery({
    ...workspaceTextFileQueryOptions(
      selectedFile?.rootPath ?? "__inactive_file_preview__",
      selectedFile?.relativePath ?? "__inactive_file_preview__",
    ),
    enabled: selectedFile !== null,
  });
  const { theme } = useTheme();
  const codeViewOptions = useMemo(
    () => ({
      theme: CODE_VIEW_THEME,
      themeType: theme,
      overflow: "wrap" as const,
      disableFileHeader: true,
    }),
    [theme],
  );
  const codeViewItems = useMemo<CodeViewFileItem[]>(() => {
    if (!selectedFile || fileQuery.data?.kind !== "text") {
      return [];
    }

    const file: FileContents = {
      name: selectedFile.relativePath,
      contents: fileQuery.data.contents,
      cacheKey: `${selectedFile.rootPath}:${selectedFile.relativePath}:${fileQuery.data.size}:${contentHash(fileQuery.data.contents)}`,
    };

    return [
      {
        id: `${selectedFile.rootPath}:${selectedFile.relativePath}`,
        type: "file",
        file,
      },
    ];
  }, [fileQuery.data, selectedFile]);

  if (!selectedFile) {
    return null;
  }

  let body: ReactElement;
  if (fileQuery.isLoading) {
    body = <FilePreviewState message="Loading file..." />;
  } else if (fileQuery.isError) {
    body = <FilePreviewState message={errorMessage(fileQuery.error)} />;
  } else if (fileQuery.data?.kind === "unsupported") {
    body = <FilePreviewState message={fileQuery.data.message} />;
  } else if (codeViewItems.length > 0) {
    body = (
      <div className="max-h-[min(45vh,28rem)] overflow-auto" style={CODE_VIEW_WRAPPER_STYLE}>
        <CodeView items={codeViewItems} options={codeViewOptions} />
      </div>
    );
  } else {
    body = <FilePreviewState message="No file selected." />;
  }

  return (
    <section className="min-h-0 border-b border-border bg-card" aria-label="Selected file preview">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {selectedFile.relativePath}
        </div>
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
      {body}
    </section>
  );
});
