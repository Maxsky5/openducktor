import { parseTaskAssetUri } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useResourceSource } from "@/lib/use-resource-source";
import {
  classifyHostImage,
  type HostImageOptions,
  type MarkdownImageProps,
  type TaskAssetImageContext,
} from "./markdown-host-image-kind";
import { MarkdownLocalImage } from "./markdown-local-image";

function ImageAlert({ children }: { children: ReactNode }) {
  return (
    <span
      className="my-2 block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
      role="alert"
    >
      {children}
    </span>
  );
}

function TaskAssetImage({
  alt,
  src,
  title,
  taskAssets: { context, resolveTaskAssetSource },
}: MarkdownImageProps & { taskAssets: TaskAssetImageContext }) {
  const assetId = parseTaskAssetUri(src);
  const { scope, taskId, workspaceId } = context;
  const resource = useResourceSource(
    ["task-asset", workspaceId, taskId, scope, assetId ?? src],
    assetId
      ? (signal) => resolveTaskAssetSource({ workspaceId, taskId, scope, assetId }, signal)
      : undefined,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (resource.error) {
    return <ImageAlert>Image could not be loaded: {errorMessage(resource.error)}</ImageAlert>;
  }
  if (resource.src !== null && failedSrc === resource.src) {
    return (
      <ImageAlert>Image could not be loaded: The task asset response failed to load.</ImageAlert>
    );
  }
  if (resource.src === null) {
    return (
      <span className="my-2 block rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        Loading image…
      </span>
    );
  }
  return (
    <img
      src={resource.src}
      alt={alt}
      title={title || undefined}
      onError={() => setFailedSrc(resource.src)}
    />
  );
}

/** An image that the host loads: a task asset, a host file, or an image of the caller's source. */
export function MarkdownHostImage({
  options,
  ...image
}: MarkdownImageProps & { options: HostImageOptions }): ReactElement | null {
  const { src, alt, title } = image;
  // The view mounts this component only for an image that it classified as a host image.
  const hostImage = classifyHostImage(src, options);
  switch (hostImage?.kind) {
    case "task-asset":
      if (!parseTaskAssetUri(src)) {
        return (
          <ImageAlert>Image could not be loaded: the task asset reference is invalid.</ImageAlert>
        );
      }
      if (!options.taskAssets) {
        return <ImageAlert>Image could not be loaded: task context is unavailable.</ImageAlert>;
      }
      return <TaskAssetImage {...image} taskAssets={options.taskAssets} />;
    case "local":
      return <MarkdownLocalImage path={hostImage.path} alt={alt} title={title || undefined} />;
    case "source": {
      const { Image } = hostImage.source;
      return <Image {...image} />;
    }
    case undefined:
      return null;
  }
}
