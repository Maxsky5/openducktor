/** Which images a Markdown view loads through the host, and how. */
import { TASK_ASSET_URI_PREFIX, type TaskAssetRenderContext } from "@openducktor/contracts";
import type { ComponentType } from "react";
import type { ShellBridge } from "@/lib/shell-bridge";
import { localImagePathOf } from "@/lib/local-image-path";

export type MarkdownImageProps = { src: string; alt: string; title: string };

/** Images of one source that a view loads through the host, such as issue attachments. */
export type MarkdownImageSource = {
  handles(src: string): boolean;
  Image: ComponentType<MarkdownImageProps>;
};

/** What a view needs to show task asset images. */
export type TaskAssetImageContext = {
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

export const classifyHostImage = (src: string, { source }: HostImageOptions): HostImage | null => {
  if (src.startsWith(TASK_ASSET_URI_PREFIX)) return { kind: "task-asset" };
  const path = localImagePathOf(src);
  if (path !== null) return { kind: "local", path };
  if (source?.handles(src)) return { kind: "source", source };
  return null;
};

/** True when the view loads `src` through the host instead of the browser. */
export const isHostImage = (src: string, options: HostImageOptions): boolean =>
  classifyHostImage(src, options) !== null;
