import { memo, useEffect, useMemo, useState } from "react";
import type { TaskArtifact, TaskAssetRenderContext } from "@openducktor/contracts";
import {
  artifactPreviewKind,
  decodeArtifactText,
} from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { hasLabeledCodeFence } from "@/lib/markdown-utils";
import { cn } from "@/lib/utils";
import { TaskArtifactHtmlPreview } from "./task-artifact-html-preview";

export type TaskArtifactPreviewProps = {
  artifact: Pick<TaskArtifact, "taskId" | "artifactId" | "name" | "mediaType">;
  markdownAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
} & ({ bytes: Uint8Array; markdown?: never } | { markdown: string; bytes?: never });

export const TaskArtifactPreview = memo(function TaskArtifactPreview(
  props: TaskArtifactPreviewProps,
) {
  const isHtml = props.artifact.mediaType.toLowerCase() === "text/html";
  return (
    <div
      role={isHtml ? undefined : "region"}
      aria-label={isHtml ? undefined : `${props.artifact.name} preview`}
      tabIndex={isHtml ? undefined : 0}
      className={cn(
        "min-h-0 min-w-0 flex-1",
        isHtml ? "flex flex-col overflow-hidden" : "overflow-auto p-4",
      )}
    >
      <PreviewContent
        key={`${props.artifact.taskId}:${props.artifact.artifactId}:${props.artifact.mediaType.toLowerCase()}`}
        {...props}
      />
    </div>
  );
});

function PreviewContent({
  artifact,
  bytes,
  markdown,
  markdownAssetContext,
}: TaskArtifactPreviewProps) {
  const mediaType = artifact.mediaType.toLowerCase();
  const kind = artifactPreviewKind(mediaType);
  const isText = kind === "markdown" || kind === "text" || kind === "html";
  const text = useMemo(() => {
    if (markdown !== undefined) return { value: markdown };
    if (!isText || !bytes) return null;
    const value = decodeArtifactText(bytes);
    return value === null
      ? { error: "The stored bytes are not valid UTF-8. Download the original file to inspect it." }
      : { value };
  }, [bytes, markdown, isText]);
  if (text && "error" in text) {
    return (
      <p
        role="alert"
        className={cn("text-sm text-destructive", kind === "html" && "min-h-0 overflow-auto p-4")}
      >
        Cannot preview {artifact.name}: {text.error}
      </p>
    );
  }
  if (text && "value" in text) {
    if (kind === "html") return <TaskArtifactHtmlPreview html={text.value} name={artifact.name} />;
    if (kind === "markdown")
      return (
        <MarkdownRenderer
          markdown={text.value}
          variant="document"
          premiumCodeBlocks={hasLabeledCodeFence(text.value)}
          {...(markdownAssetContext ? { taskAssetContext: markdownAssetContext } : {})}
        />
      );
    return <pre className="whitespace-pre-wrap break-words font-mono text-sm">{text.value}</pre>;
  }
  if (kind === "image" && bytes)
    return <ImagePreview bytes={bytes} mediaType={mediaType} name={artifact.name} />;
  return (
    <p className="text-sm text-muted-foreground">
      No preview is available for {artifact.mediaType}. Download this artifact to open it.
    </p>
  );
}

function ImagePreview({
  bytes,
  mediaType,
  name,
}: {
  bytes: Uint8Array;
  mediaType: string;
  name: string;
}) {
  const [source, setSource] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mediaType }));
    setSource({ bytes, url });
    return () => URL.revokeObjectURL(url);
  }, [bytes, mediaType]);
  const url = source?.bytes === bytes ? source.url : null;
  if (url && failed === url)
    return (
      <p role="alert" className="text-sm text-destructive">
        Cannot preview {name}: the image could not be decoded. Download the original file to inspect
        it.
      </p>
    );
  if (!url)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading image...
      </p>
    );
  return (
    <img
      src={url}
      alt={name}
      className="mx-auto h-auto max-h-full max-w-full object-contain"
      onError={() => setFailed(url)}
    />
  );
}
