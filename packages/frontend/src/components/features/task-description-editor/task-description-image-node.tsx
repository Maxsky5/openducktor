import { parseTaskAssetUri, type TaskAssetRenderContext } from "@openducktor/contracts";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useContext, useState } from "react";
import { z } from "zod";
import { GithubIssueImage } from "@/components/features/issue-source/github-issue-image";
import { isGithubIssueAttachmentUrl } from "@/components/features/issue-source/issue-image-url";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { getShellBridge } from "@/lib/shell-bridge";
import { useResourceSource } from "@/lib/use-resource-source";
import { TaskDescriptionImageContext } from "./task-description-image-context";

type TaskDescriptionImageNodeProps = {
  node: {
    attrs: {
      src?: unknown;
      alt?: unknown;
      title?: unknown;
    };
  };
  selected: boolean;
  updateAttributes: ReactNodeViewProps["updateAttributes"];
};

export function TaskDescriptionImageNode({
  node,
  selected,
  updateAttributes,
}: TaskDescriptionImageNodeProps) {
  const { previews, renderContext, issueImageContext, renderImage } = useContext(
    TaskDescriptionImageContext,
  );
  const { source, alt, title } = imageAttributes(node.attrs);
  const assetId = parseTaskAssetUri(source);
  const isGithubIssueImage =
    issueImageContext?.providerId === "github" && isGithubIssueAttachmentUrl(source);
  const preview = assetId ? previews.get(assetId) : undefined;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const fileImage = renderImage?.({
    src: source,
    alt,
    title,
    className: "mx-auto max-h-96 max-w-full rounded object-contain",
  });

  const { src: resolvedSource, error: loadError } = useTaskImageSource(
    source,
    preview,
    renderContext,
    !isGithubIssueImage && !fileImage,
    failedSrc,
  );

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <figure className="overflow-hidden rounded-md border border-border bg-card p-2">
        {isGithubIssueImage && issueImageContext ? (
          <GithubIssueImage
            context={issueImageContext}
            src={source}
            alt={alt}
            title={title}
            className="mx-auto max-h-96 max-w-full rounded object-contain"
          />
        ) : fileImage ? (
          fileImage
        ) : resolvedSource ? (
          <img
            src={resolvedSource}
            alt={alt}
            title={title}
            className="mx-auto max-h-96 max-w-full rounded object-contain"
            onError={() => setFailedSrc(resolvedSource)}
          />
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded bg-muted/40 px-3 text-sm text-muted-foreground">
            {loadError ?? "Loading image…"}
          </div>
        )}
        {selected ? (
          <figcaption className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input
              value={alt}
              aria-label="Image alt text"
              placeholder="Alt text"
              onChange={(event) => updateAttributes({ alt: event.currentTarget.value })}
            />
            <Input
              value={title ?? ""}
              aria-label="Image title"
              placeholder="Optional title"
              onChange={(event) => updateAttributes({ title: event.currentTarget.value || null })}
            />
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}

function useTaskImageSource(
  source: string,
  preview: string | undefined,
  context: Omit<TaskAssetRenderContext, "assetId"> | null,
  enabled: boolean,
  failedSrc: string | null,
) {
  const assetId = parseTaskAssetUri(source);
  const workspaceId = context?.workspaceId ?? "";
  const taskId = context?.taskId ?? "";
  const resource = useResourceSource(
    ["task-asset", workspaceId, taskId, "description", assetId ?? source],
    enabled && assetId && workspaceId && taskId && !preview
      ? (signal) =>
          getShellBridge().resolveTaskAssetSource(
            { workspaceId, taskId, scope: "description", assetId },
            signal,
          )
      : undefined,
  );
  return imageSource(source, preview, context, resource, failedSrc);
}

function imageSource(
  source: string,
  preview: string | undefined,
  context: Omit<TaskAssetRenderContext, "assetId"> | null,
  resource: Pick<ReturnType<typeof useResourceSource>, "src" | "error">,
  failedSrc: string | null,
) {
  const assetId = parseTaskAssetUri(source);
  let src = assetId ? (preview ?? resource.src) : source;
  let error = resource.error ? errorMessage(resource.error) : null;
  if (assetId && !preview && (!context?.workspaceId || !context.taskId))
    error = "This image will be available after the task is saved.";
  if (src !== null && failedSrc === src) {
    src = null;
    error = assetId ? "The task asset response failed to load." : "The image could not be loaded.";
  }
  return { src, error };
}

function imageAttributes(attrs: TaskDescriptionImageNodeProps["node"]["attrs"]) {
  const source = z.string().safeParse(attrs.src);
  const alt = z.string().safeParse(attrs.alt);
  const title = z.string().safeParse(attrs.title);
  return {
    source: source.success ? source.data : "",
    alt: alt.success ? alt.data : "",
    title: title.success ? title.data : undefined,
  };
}
