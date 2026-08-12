import {
  parseTaskAssetUri,
  TASK_ASSET_URI_PREFIX,
  type TaskAssetRenderContext,
} from "@openducktor/contracts";
import {
  type ComponentProps,
  type ComponentType,
  isValidElement,
  useEffect,
  useState,
} from "react";
import {
  type Components,
  defaultUrlTransform,
  type ExtraProps,
  type UrlTransform,
} from "react-markdown";
import { splitTaskDescriptionFrontMatter } from "@/components/features/task-description-editor/task-description-front-matter";
import { errorMessage } from "@/lib/errors";
import type { ShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { MarkdownMermaid } from "./markdown-mermaid";

export const TASK_DESCRIPTION_URL_TRANSFORM: UrlTransform = (url, _key, node) => {
  if (node.tagName === "img" && url.startsWith(TASK_ASSET_URI_PREFIX)) {
    return url;
  }
  return defaultUrlTransform(url);
};

function TaskAssetImage({
  alt,
  className,
  context,
  resolveTaskAssetSrc,
  src,
  title,
}: {
  alt?: string;
  className?: string;
  context: Omit<TaskAssetRenderContext, "assetId">;
  resolveTaskAssetSrc: ShellBridge["resolveTaskAssetSrc"];
  src: string;
  title?: string;
}) {
  const assetId = parseTaskAssetUri(src);
  const { scope, taskId, workspaceId } = context;
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; src: string } | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    if (!assetId) {
      setState({ status: "error", message: "The task asset reference is invalid." });
      return () => {
        active = false;
      };
    }
    setState({ status: "loading" });
    void resolveTaskAssetSrc({ workspaceId, taskId, scope, assetId })
      .then((resolvedSrc) => {
        if (active) setState({ status: "ready", src: resolvedSrc });
      })
      .catch((cause: unknown) => {
        if (active) setState({ status: "error", message: errorMessage(cause) });
      });
    return () => {
      active = false;
    };
  }, [assetId, resolveTaskAssetSrc, scope, taskId, workspaceId]);

  if (state.status === "loading") {
    return (
      <span className="my-2 block rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        Loading image…
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span
        className="my-2 block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        Image could not be loaded: {state.message}
      </span>
    );
  }
  return (
    <img
      src={state.src}
      alt={alt ?? ""}
      title={title}
      className={className}
      onError={() =>
        setState({ status: "error", message: "The task asset response failed to load." })
      }
    />
  );
}

export const prepareMarkdownRenderContent = (
  markdown: string,
  stripTaskDescriptionFrontMatter: boolean,
): string => {
  if (!stripTaskDescriptionFrontMatter) {
    return markdown.trim();
  }
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  return (frontMatter.kind === "valid" ? frontMatter.body : markdown).trim();
};

export const createTaskDescriptionComponents = ({
  components,
  resolveTaskAssetSrc,
  taskAssetContext,
}: {
  components: Components;
  resolveTaskAssetSrc?: ShellBridge["resolveTaskAssetSrc"];
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
}): Components => ({
  ...components,
  code: ({ className, children, ...props }) => {
    if (className === "language-mermaid") {
      return <MarkdownMermaid source={String(children).replace(/\n$/, "")} />;
    }
    const CodeComponent = components.code as
      | ComponentType<ComponentProps<"code"> & ExtraProps>
      | undefined;
    if (CodeComponent) {
      return (
        <CodeComponent {...props} className={className}>
          {children}
        </CodeComponent>
      );
    }
    const { node: _node, ...codeProps } = props;
    return (
      <code {...codeProps} className={className}>
        {children}
      </code>
    );
  },
  img: ({ alt, className, src, title }) => {
    if (src?.startsWith(TASK_ASSET_URI_PREFIX)) {
      if (!parseTaskAssetUri(src)) {
        return (
          <span
            className="my-2 block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            Image could not be loaded: the task asset reference is invalid.
          </span>
        );
      }
      if (!taskAssetContext || !resolveTaskAssetSrc) {
        return (
          <span
            className="my-2 block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            Image could not be loaded: task context is unavailable.
          </span>
        );
      }
      return (
        <TaskAssetImage
          context={taskAssetContext}
          resolveTaskAssetSrc={resolveTaskAssetSrc}
          src={src}
          {...(alt === undefined ? {} : { alt })}
          {...(className === undefined ? {} : { className })}
          {...(title === undefined ? {} : { title })}
        />
      );
    }
    return <img alt={alt ?? ""} className={className} src={src} title={title} />;
  },
  pre: ({ children, className, ...props }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      isValidElement<{ className?: string; children?: unknown }>(child) &&
      child.props.className === "language-mermaid"
    ) {
      return <MarkdownMermaid source={String(child.props.children).replace(/\n$/, "")} />;
    }
    const PreComponent = components.pre as
      | ComponentType<ComponentProps<"pre"> & ExtraProps>
      | undefined;
    if (PreComponent) {
      return (
        <PreComponent {...props} className={className}>
          {children}
        </PreComponent>
      );
    }
    const { node: _node, ...preProps } = props;
    return (
      <pre {...preProps} className={cn("overflow-x-auto", className)}>
        {children}
      </pre>
    );
  },
});
