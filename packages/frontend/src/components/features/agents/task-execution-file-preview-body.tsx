import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import type { Editor, EditorType } from "@pierre/diffs/edit";
import { lazy, Suspense, type ReactElement, type RefObject, useState, useCallback } from "react";
import type { MarkdownImageProps } from "../task-description-editor/task-description-image-context";
import { isChatLocalDestination } from "./agent-chat/agent-chat-file-link";
import { MarkdownFileImage } from "./markdown-file-image";
import {
  isMarkdownFile,
  type TaskExecutionSelectedFile,
  taskExecutionSelectedFileKey,
} from "./task-execution-file-explorer-model";
import { TaskExecutionFileCodeView, type CodeViewFile } from "./task-execution-file-code-view";
import type { useTaskExecutionFileEditor } from "./use-task-execution-file-editor";

export type FilePreviewSnapshot = {
  selectedFile: TaskExecutionSelectedFile;
  result: WorkspaceTextFileReadResult;
  codeViewFile: CodeViewFile | null;
};

type FilePreviewBodyProps = {
  snapshot: FilePreviewSnapshot | null;
  message: string | null;
  previewSessionKey: number;
  editor: Pick<
    ReturnType<typeof useTaskExecutionFileEditor>,
    "draftContents" | "isSaving" | "session" | "onContentsChange" | "onItemEditChange"
  >;
  editable: boolean;
  hasPendingDiscard: boolean;
  editorRef: RefObject<Editor<EditorType, undefined, undefined> | null>;
};

export function FilePreviewBody({
  snapshot,
  message,
  previewSessionKey,
  editor,
  editable,
  hasPendingDiscard,
  editorRef,
}: FilePreviewBodyProps): ReactElement {
  const fileId = snapshot ? taskExecutionSelectedFileKey(snapshot.selectedFile) : null;
  if (message !== null) {
    return <FilePreviewState message={message} />;
  }
  if (snapshot?.result.kind === "image") {
    return (
      <ImageFilePreview
        key={`${previewSessionKey}:${fileId}:${snapshot.result.revision}`}
        result={snapshot.result}
      />
    );
  }
  if (snapshot?.result.kind === "text" && isMarkdownFile(snapshot.selectedFile.relativePath)) {
    return (
      <MarkdownFileEditor
        key={`${previewSessionKey}:${fileId}:${snapshot.result.revision}`}
        contents={editable ? editor.draftContents : snapshot.result.contents}
        file={snapshot.selectedFile}
        disabled={!editable || hasPendingDiscard || editor.isSaving}
        onChange={editor.onContentsChange}
      />
    );
  }
  if (snapshot?.codeViewFile) {
    return (
      <TaskExecutionFileCodeView
        key={`${previewSessionKey}:${fileId}`}
        file={snapshot.codeViewFile}
        editable={editable}
        version={editable ? (editor.session?.version ?? 0) + 1 : 0}
        editorRef={editorRef}
        onItemEditChange={editor.onItemEditChange}
      />
    );
  }
  return <FilePreviewState message="No file selected." />;
}

const TaskDescriptionEditor = lazy(
  () => import("../task-description-editor/task-description-editor"),
);
const EMPTY_UPLOADS: [] = [];
const EMPTY_PREVIEWS = new Map<string, string>();

function ImageFilePreview({
  result,
}: {
  result: Extract<WorkspaceTextFileReadResult, { kind: "image" }>;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <FilePreviewState message="The image could not be displayed. Check that the file is a supported image." />
    );
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-4">
      <img
        src={`data:${result.mime};base64,${result.base64}`}
        alt={result.relativePath}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function MarkdownFileEditor({
  contents,
  file,
  disabled,
  onChange,
}: {
  contents: string;
  file: TaskExecutionSelectedFile;
  disabled: boolean;
  onChange(contents: string): void;
}): ReactElement {
  const renderImage = useCallback(
    (props: MarkdownImageProps) =>
      isChatLocalDestination(props.src) ? <MarkdownFileImage file={file} {...props} /> : null,
    [file],
  );
  return (
    <div className="h-full overflow-auto p-4">
      <Suspense fallback={<FilePreviewState message="Loading Markdown editor..." />}>
        <TaskDescriptionEditor
          markdown={contents}
          disabled={disabled}
          workspaceId={null}
          taskId={null}
          uploads={EMPTY_UPLOADS}
          previews={EMPTY_PREVIEWS}
          renderImage={renderImage}
          onChange={onChange}
        />
      </Suspense>
    </div>
  );
}

function FilePreviewState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
