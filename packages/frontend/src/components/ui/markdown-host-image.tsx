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

/** How the host loads an image: as a task asset, as a host file, or through the caller source. */
type HostImage =
  | { kind: "task-asset" }
  | { kind: "local"; path: string }
  | { kind: "source"; source: MarkdownImageSource };

const classifyHostImage = (src: string, { source }: HostImageOptions): HostImage | null => {
  if (src.startsWith(TASK_ASSET_URI_PREFIX)) return { kind: "task-asset" };
  const path = localImagePathOf(src);
  if (path !== null) return { kind: "local", path };
  if (source?.handles(src)) return { kind: "source", source };
  return null;
};

/** True when the view loads `src` through the host instead of the browser. */
export const isHostImage = (src: string, options: HostImageOptions): boolean =>
  classifyHostImage(src, options) !== null;

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
