import {
  type DragEvent,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AgentChatModel } from "./agent-chat.types";
import { AgentChatComposer, type AgentChatComposerHandle } from "./agent-chat-composer";
import { AgentChatThread } from "./agent-chat-thread";

const MemoizedAgentChatThread = memo(AgentChatThread);

const hasDraggedFiles = (event: DragEvent<HTMLDivElement>): boolean => {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
};

export function AgentChat({
  model,
  header,
}: {
  model: AgentChatModel;
  header?: ReactNode;
}): ReactElement {
  const composerRef = useRef<AgentChatComposerHandle | null>(null);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      composerRef.current?.addFiles(files);
    }
  }, []);

  useEffect(() => {
    const node = dropTargetRef.current;
    if (!node) {
      return;
    }

    const onDragEnter = (event: Event): void => {
      handleDragEnter(event as unknown as DragEvent<HTMLDivElement>);
    };
    const onDragOver = (event: Event): void => {
      handleDragOver(event as unknown as DragEvent<HTMLDivElement>);
    };
    const onDragLeave = (event: Event): void => {
      handleDragLeave(event as unknown as DragEvent<HTMLDivElement>);
    };
    const onDrop = (event: Event): void => {
      handleDrop(event as unknown as DragEvent<HTMLDivElement>);
    };

    node.addEventListener("dragenter", onDragEnter);
    node.addEventListener("dragover", onDragOver);
    node.addEventListener("dragleave", onDragLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", onDragEnter);
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

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
          <AgentChatComposer ref={composerRef} model={model.composer} />
        </div>
      </div>
    </div>
  );
}
