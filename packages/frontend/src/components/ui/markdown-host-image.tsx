import {
  parseTaskAssetUri,
  TASK_ASSET_URI_PREFIX,
  type TaskAssetRenderContext,
} from "@openducktor/contracts";
import { type ComponentType, type ReactElement, type ReactNode, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ShellBridge } from "@/lib/shell-bridge";
import { localImagePathOf } from "@/lib/local-image-path";
import { useResourceSource } from "@/lib/use-resource-source";
import { MarkdownLocalImage } from "./markdown-local-image";

export type MarkdownImageProps = { src: string; alt: string; title: string };

/** Images of one source that a view loads through the host, such as issue attachments. */
export type MarkdownImageSource = {
  handles(src: string): boolean;
  Image: ComponentType<MarkdownImageProps>;
};

/** What a view needs to show task asset images. */
type TaskAssetImageContext = {
  context: Omit<TaskAssetRenderContext, "assetId">;
  resolveTaskAssetSource: ShellBridge["resolveTaskAssetSource"];
};

export type HostImageOptions = {
  taskAssets: TaskAssetImageContext | null;
  source: MarkdownImageSource | null;
};

/** True when the view loads `src` through the host instead of the browser. */
export const isHostImage = (src: string, { source }: HostImageOptions): boolean =>
  src.startsWith(TASK_ASSET_URI_PREFIX) || localImagePathOf(src) !== null || !!source?.handles(src);

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
  if (src.startsWith(TASK_ASSET_URI_PREFIX)) {
    if (!parseTaskAssetUri(src)) {
      return (
        <ImageAlert>Image could not be loaded: the task asset reference is invalid.</ImageAlert>
      );
    }
    if (!options.taskAssets) {
      return <ImageAlert>Image could not be loaded: task context is unavailable.</ImageAlert>;
    }
    return <TaskAssetImage {...image} taskAssets={options.taskAssets} />;
  }
  const localPath = localImagePathOf(src);
  if (localPath !== null) {
    return <MarkdownLocalImage path={localPath} alt={alt} title={title || undefined} />;
  }
  if (options.source?.handles(src)) {
    const { Image } = options.source;
    return <Image {...image} />;
  }
  return null;
}
