import {
  parseTaskAssetUri,
  TASK_ASSET_URI_PREFIX,
  type TaskAssetRenderContext,
} from "@openducktor/contracts";
import { createElement, isValidElement, useMemo, useState, type ReactNode } from "react";
import { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { useResourceSource } from "@/lib/use-resource-source";
import { MarkdownMermaid } from "./markdown-mermaid";

/** The default URL rule, which also keeps task asset images. */
export const RICH_MARKDOWN_URL_TRANSFORM: UrlTransform = (url, _key, node) => {
  if (node.tagName === "img" && url.startsWith(TASK_ASSET_URI_PREFIX)) {
    return url;
  }
  return defaultUrlTransform(url);
};

function TaskAssetAlert({ children }: { children: ReactNode }) {
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
  className,
  context,
  resolveTaskAssetSource,
  src,
  title,
}: {
  alt?: string;
  className?: string;
  context: Omit<TaskAssetRenderContext, "assetId">;
  resolveTaskAssetSource: ShellBridge["resolveTaskAssetSource"];
  src: string;
  title?: string;
}) {
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
    return (
      <TaskAssetAlert>Image could not be loaded: {errorMessage(resource.error)}</TaskAssetAlert>
    );
  }
  if (resource.src !== null && failedSrc === resource.src) {
    return (
      <TaskAssetAlert>
        Image could not be loaded: The task asset response failed to load.
      </TaskAssetAlert>
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
      alt={alt ?? ""}
      title={title}
      className={className}
      onError={() => setFailedSrc(resource.src)}
    />
  );
}

/** What a Markdown view needs to show task asset images. */
export type TaskAssetOptions = {
  resolveTaskAssetSource?: ShellBridge["resolveTaskAssetSource"] | undefined;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId"> | undefined;
};

/**
 * Adds Mermaid diagrams and task asset images to `components`. react-markdown uses each component
 * as an element type. A new set on each render remounts every code block, diagram, and image, so
 * keep one set while the inputs stay the same.
 */
export const useRichMarkdownComponents = (
  components: Components,
  { resolveTaskAssetSource, taskAssetContext }: TaskAssetOptions = {},
): Components =>
  useMemo(
    () => createRichMarkdownComponents(components, resolveTaskAssetSource, taskAssetContext),
    [components, resolveTaskAssetSource, taskAssetContext],
  );

const createRichMarkdownComponents = (
  components: Components,
  resolveTaskAssetSource: ShellBridge["resolveTaskAssetSource"] | undefined,
  taskAssetContext: Omit<TaskAssetRenderContext, "assetId"> | undefined,
): Components => ({
  ...components,
  code: ({ className, children, ...props }) => {
    if (className === "language-mermaid") {
      return <MarkdownMermaid source={String(children).replace(/\n$/, "")} expandable />;
    }
    const CodeComponent = components.code;
    if (CodeComponent) {
      return createElement(CodeComponent, { ...props, className }, children);
    }
    const { node: _node, ...codeProps } = props;
    return (
      <code {...codeProps} className={className}>
        {children}
      </code>
    );
  },
  img: ({ alt, className, src, title, ...props }) => {
    if (src?.startsWith(TASK_ASSET_URI_PREFIX)) {
      if (parseTaskAssetUri(src) && taskAssetContext && resolveTaskAssetSource) {
        return (
          <TaskAssetImage
            context={taskAssetContext}
            resolveTaskAssetSource={resolveTaskAssetSource}
            src={src}
            {...(alt === undefined ? {} : { alt })}
            {...(className === undefined ? {} : { className })}
            {...(title === undefined ? {} : { title })}
          />
        );
      }
    }
    const callerImage = components.img
      ? createElement(components.img, { ...props, alt, className, src, title })
      : null;
    if (src?.startsWith(TASK_ASSET_URI_PREFIX)) {
      if (!parseTaskAssetUri(src)) {
        return (
          callerImage ?? (
            <TaskAssetAlert>
              Image could not be loaded: the task asset reference is invalid.
            </TaskAssetAlert>
          )
        );
      }
      return (
        callerImage ?? (
          <TaskAssetAlert>Image could not be loaded: task context is unavailable.</TaskAssetAlert>
        )
      );
    }
    return callerImage ?? <img alt={alt ?? ""} className={className} src={src} title={title} />;
  },
  pre: ({ children, className, ...props }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      isValidElement<{ className?: string; children?: unknown }>(child) &&
      child.props.className === "language-mermaid"
    ) {
      return (
        <MarkdownMermaid source={String(child.props.children).replace(/\n$/, "")} expandable />
      );
    }
    if (components.pre) {
      return createElement(components.pre, { ...props, className }, children);
    }
    const { node: _node, ...preProps } = props;
    return (
      <pre {...preProps} className={cn("overflow-x-auto", className)}>
        {children}
      </pre>
    );
  },
});
