import {
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AgentChatModel, AgentChatSurfaceModel } from "./agent-chat.types";
import { AgentChatComposer, type AgentChatComposerHandle } from "./agent-chat-composer";
import { AgentChatThread } from "./agent-chat-thread";

const MemoizedAgentChatThread = memo(AgentChatThread);
const MemoizedAgentChatComposer = memo(AgentChatComposer);

const hasDraggedFiles = (dataTransfer: DataTransfer | null | undefined): boolean => {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")) {
    return true;
  }

  return Array.from(dataTransfer.types ?? []).includes("Files");
};

export function AgentChatSurface({
  model,
  header,
}: {
  model: AgentChatSurfaceModel;
  header?: ReactNode;
}): ReactElement {
  const composerRef = useRef<AgentChatComposerHandle | null>(null);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const isDraggingFilesRef = useRef(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const supportsComposer =
    (model.mode ?? "interactive") === "interactive" && model.composer !== undefined;
  const composerModel = model.composer;

  const handleDragEnter = useCallback(
    (event: DragEvent): void => {
      if (!supportsComposer) {
        return;
      }
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      isDraggingFilesRef.current = true;
      setIsDraggingFiles(true);
    },
    [supportsComposer],
  );

  const handleDragOver = useCallback(
    (event: DragEvent): void => {
      if (!supportsComposer) {
        return;
      }
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      isDraggingFilesRef.current = true;
      setIsDraggingFiles(true);
    },
    [supportsComposer],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent): void => {
      if (!supportsComposer) {
        return;
      }
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        isDraggingFilesRef.current = false;
        setIsDraggingFiles(false);
      }
    },
    [supportsComposer],
  );

  const handleDrop = useCallback(
    (event: DragEvent): void => {
      if (!supportsComposer) {
        return;
      }
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = 0;
      isDraggingFilesRef.current = false;
      setIsDraggingFiles(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        composerRef.current?.addFiles(files);
      }
    },
    [supportsComposer],
  );

  useEffect(() => {
    if (!supportsComposer) {
      dragDepthRef.current = 0;
      isDraggingFilesRef.current = false;
      setIsDraggingFiles(false);
      return;
    }
    const node = dropTargetRef.current;
    if (!node) {
      return;
    }

    const onDragEnter = (event: DragEvent): void => {
      handleDragEnter(event);
    };
    const onDragOver = (event: DragEvent): void => {
      handleDragOver(event);
    };
    const onDragLeave = (event: DragEvent): void => {
      handleDragLeave(event);
    };
    const onDrop = (event: DragEvent): void => {
      handleDrop(event);
    };
    const onWindowDragOver = (event: DragEvent): void => {
      if (dragDepthRef.current === 0 && !isDraggingFilesRef.current) {
        return;
      }
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onWindowDrop = (event: DragEvent): void => {
      if (hasDraggedFiles(event.dataTransfer)) {
        event.preventDefault();
        event.stopPropagation();
      }
      dragDepthRef.current = 0;
      isDraggingFilesRef.current = false;
      setIsDraggingFiles(false);
    };
    const onWindowDragEnd = (): void => {
      dragDepthRef.current = 0;
      isDraggingFilesRef.current = false;
      setIsDraggingFiles(false);
    };

    node.addEventListener("dragenter", onDragEnter);
    node.addEventListener("dragover", onDragOver);
    node.addEventListener("dragleave", onDragLeave);
    node.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("dragend", onWindowDragEnd);
    return () => {
      node.removeEventListener("dragenter", onDragEnter);
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      window.removeEventListener("dragend", onWindowDragEnd);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop, supportsComposer]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {header}
      <div className="min-h-0 flex-1 bg-muted">
        <div
          ref={dropTargetRef}
          data-testid="agent-chat-drop-target"
          className="relative flex h-full min-h-0 flex-col"
        >
          {isDraggingFiles ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6">
              <div className="rounded-xl border border-primary bg-card px-6 py-5 text-center shadow-xl">
                <p className="text-sm font-semibold text-foreground">Drop files to attach them</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Images, audio, video, and PDF files are supported.
                </p>
              </div>
            </div>
          ) : null}
          <MemoizedAgentChatThread model={model.thread} />
          {supportsComposer && composerModel ? (
            <MemoizedAgentChatComposer ref={composerRef} model={composerModel} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AgentChat({
  model,
  header,
}: {
  model: AgentChatModel;
  header?: ReactNode;
}): ReactElement {
  return <AgentChatSurface model={model} header={header} />;
}
