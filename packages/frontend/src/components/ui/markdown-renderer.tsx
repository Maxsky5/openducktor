import { markdownLinkComponents, type MarkdownLinkPolicy } from "./markdown-link-policy";
import { TASK_ASSET_URI_PREFIX, type TaskAssetRenderContext } from "@openducktor/contracts";
import {
  type ComponentProps,
  createElement,
  lazy,
  memo,
  type ReactElement,
  type ReactNode,
  Suspense,
  useMemo,
} from "react";
import type { Components } from "react-markdown";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { renderMarkdownElement } from "./markdown-render-element";
import {
  MARKDOWN_CLASSES,
  MARKDOWN_COMPONENTS,
  type MarkdownRendererVariant,
} from "./markdown-renderer-components";
import { prepareMarkdownRenderContent } from "./markdown-render-content";

const PremiumMarkdownRenderer = lazy(() => import("./markdown-renderer-premium"));
const MarkdownRendererRich = lazy(() => import("./markdown-renderer-rich"));
const MarkdownRendererMathCandidate = lazy(() => import("./markdown-renderer-math-candidate"));
const MarkdownRendererMermaidCandidate = lazy(
  () => import("./markdown-renderer-mermaid-candidate"),
);

export type { MarkdownRendererVariant } from "./markdown-renderer-components";

export type MarkdownPremiumRendererProps = {
  markdown: string;
  components: Components;
  linkPolicy?: MarkdownLinkPolicy | undefined;
  fallback?: ReactNode;
};

type MarkdownRendererProps = {
  markdown: string;
  variant?: MarkdownRendererVariant;
  className?: string;
  components?: Components;
  linkPolicy?: MarkdownLinkPolicy | undefined;
  premiumCodeBlocks?: boolean;
  fallback?: ReactNode;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  stripTaskDescriptionFrontMatter?: boolean;
  lightweight?: boolean;
};

type MarkdownRendererCandidate = "mermaid" | "math";

type MarkdownTaskAssetProps = Pick<
  ComponentProps<typeof MarkdownRendererRich>,
  "taskAssetContext" | "resolveTaskAssetSource"
>;

const selectMarkdownCandidate = (
  content: string,
  lightweight: boolean,
): MarkdownRendererCandidate | null => {
  if (lightweight) {
    return null;
  }
  if (content.includes("mermaid")) {
    return "mermaid";
  }
  if (content.includes("$")) {
    return "math";
  }
  return null;
};

const resolveTaskAssetProps = (
  taskAssetContext: MarkdownRendererProps["taskAssetContext"],
): MarkdownTaskAssetProps => {
  if (!taskAssetContext) {
    return {};
  }
  const props: MarkdownTaskAssetProps = { taskAssetContext };
  const resolveTaskAssetSource = getShellBridge().resolveTaskAssetSource;
  if (resolveTaskAssetSource) {
    props.resolveTaskAssetSource = resolveTaskAssetSource;
  }
  return props;
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  markdown,
  variant = "document",
  className,
  components: componentOverrides,
  linkPolicy,
  premiumCodeBlocks = false,
  fallback,
  taskAssetContext,
  stripTaskDescriptionFrontMatter = false,
  lightweight = false,
}: MarkdownRendererProps): ReactElement | null {
  const components = useMemo(
    () => markdownLinkComponents(MARKDOWN_COMPONENTS[variant], componentOverrides, linkPolicy),
    [variant, componentOverrides, linkPolicy],
  );
  const content = prepareMarkdownRenderContent(markdown, stripTaskDescriptionFrontMatter);
  if (!content) {
    return null;
  }

  const candidate = selectMarkdownCandidate(content, lightweight);
  const needsRichRenderer =
    taskAssetContext !== undefined || (!lightweight && content.includes(TASK_ASSET_URI_PREFIX));
  const taskAssetProps = resolveTaskAssetProps(taskAssetContext);
  const loadingFallback =
    fallback === undefined
      ? createElement(renderMarkdownElement, { markdown: content, components, linkPolicy })
      : fallback;

  let renderedContent: ReactElement;
  if (needsRichRenderer) {
    renderedContent = (
      <Suspense fallback={loadingFallback}>
        <MarkdownRendererRich
          markdown={content}
          components={components}
          linkPolicy={linkPolicy}
          premiumCodeBlocks={premiumCodeBlocks}
          fallback={fallback}
          {...taskAssetProps}
        />
      </Suspense>
    );
  } else if (premiumCodeBlocks) {
    renderedContent = (
      <Suspense fallback={loadingFallback}>
        <PremiumMarkdownRenderer
          markdown={content}
          components={components}
          linkPolicy={linkPolicy}
          fallback={fallback}
        />
      </Suspense>
    );
  } else {
    renderedContent = renderMarkdownElement({ markdown: content, components, linkPolicy });
  }

  if (candidate !== null) {
    const CandidateRenderer =
      candidate === "mermaid" ? MarkdownRendererMermaidCandidate : MarkdownRendererMathCandidate;
    renderedContent = (
      <Suspense fallback={renderedContent}>
        <CandidateRenderer
          markdown={content}
          components={components}
          linkPolicy={linkPolicy}
          fallbackContent={renderedContent}
          premiumCodeBlocks={premiumCodeBlocks}
          fallback={fallback}
          {...taskAssetProps}
        />
      </Suspense>
    );
  }

  return <div className={cn(MARKDOWN_CLASSES[variant], className)}>{renderedContent}</div>;
});
