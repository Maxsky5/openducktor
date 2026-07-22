import "katex/dist/katex.min.css";
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ShellBridge } from "@/lib/shell-bridge";
import {
  createTaskDescriptionComponents,
  TASK_DESCRIPTION_URL_TRANSFORM,
  taskDescriptionRenderContent,
} from "./markdown-renderer-context";

export default function MarkdownRendererMath({
  markdown,
  components,
  resolveTaskAssetSrc,
  taskAssetContext,
}: {
  markdown: string;
  components: Components;
  resolveTaskAssetSrc?: ShellBridge["resolveTaskAssetSrc"];
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
}): ReactElement | null {
  const content = taskDescriptionRenderContent(markdown);
  if (!content) return null;
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      skipHtml
      urlTransform={TASK_DESCRIPTION_URL_TRANSFORM}
      components={createTaskDescriptionComponents({
        components,
        ...(resolveTaskAssetSrc ? { resolveTaskAssetSrc } : {}),
        ...(taskAssetContext ? { taskAssetContext } : {}),
      })}
    >
      {content}
    </Markdown>
  );
}
