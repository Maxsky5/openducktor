import {
  markdownLinkComponents,
  markdownLinkUrlTransform,
  type MarkdownLinkPolicy,
} from "./markdown-link-policy";
import { lazy, memo, type ReactElement, Suspense, useMemo, useState } from "react";
import type { Components, UrlTransform } from "react-markdown";
import { cn } from "@/lib/utils";
import { MarkdownOpenFenceContext } from "./markdown-open-fence";
import {
  MARKDOWN_CLASSES,
  MARKDOWN_COMPONENTS,
  type MarkdownRendererVariant,
} from "./markdown-renderer-components";
import {
  RICH_MARKDOWN_URL_TRANSFORM,
  useRichMarkdownComponents,
} from "./markdown-renderer-context";
import {
  type DescribedMarkdown,
  describeCompleteMarkdown,
  describeMarkdown,
  type MarkdownBlockContent,
} from "./markdown-stream-content";
import { renderMarkdownBlock } from "./markdown-stream-tree";

const MarkdownStreamMathBlock = lazy(() => import("./markdown-stream-renderer-math"));

type MarkdownStreamRendererProps = {
  markdown: string;
  /** True while the text grows at its end. A diagram in a fence that is not closed then waits. */
  streaming: boolean;
  variant?: MarkdownRendererVariant;
  className?: string;
  linkPolicy?: MarkdownLinkPolicy | undefined;
};

/**
 * Renders Markdown that can stream, block by block. An update renders only the blocks that
 * changed, and each block renders as it does in the whole text.
 */
export const MarkdownStreamRenderer = memo(function MarkdownStreamRenderer({
  markdown,
  streaming,
  variant = "document",
  className,
  linkPolicy,
}: MarkdownStreamRendererProps): ReactElement {
  const described = useDescribedMarkdown(markdown, streaming);
  const linkComponents = useMemo(
    () => markdownLinkComponents(MARKDOWN_COMPONENTS[variant], undefined, linkPolicy),
    [variant, linkPolicy],
  );
  const components = useRichMarkdownComponents(linkComponents);
  const urlTransform = useMemo(
    () => markdownLinkUrlTransform(RICH_MARKDOWN_URL_TRANSFORM, linkPolicy),
    [linkPolicy],
  );
  // An open fence at the end can be in a footnote definition, which renders in the footnote list.
  const endsInOpenFence = streaming && (described.blocks.at(-1)?.endsInOpenFence ?? false);

  return (
    <div className={cn(MARKDOWN_CLASSES[variant], className)}>
      {described.blocks.map((block) => (
        <MarkdownOpenFenceContext.Provider
          // Text streams only into the end, so a block keeps its start.
          key={block.start}
          value={streaming && block.endsInOpenFence}
        >
          <MarkdownStreamBlock
            content={block.content}
            components={components}
            urlTransform={urlTransform}
          />
        </MarkdownOpenFenceContext.Provider>
      ))}
      {described.footnotes ? (
        <MarkdownOpenFenceContext.Provider key="footnotes" value={endsInOpenFence}>
          <MarkdownStreamBlock
            content={described.footnotes.content}
            components={components}
            urlTransform={urlTransform}
          />
        </MarkdownOpenFenceContext.Provider>
      ) : null}
    </div>
  );
});

/**
 * A text that never streamed comes from the cache of complete texts. Once the text streams, each
 * change parses only its end again.
 */
const useDescribedMarkdown = (markdown: string, streaming: boolean): DescribedMarkdown => {
  const [streamed, setStreamed] = useState<DescribedMarkdown | null>(null);
  if (streamed === null && !streaming) {
    return describeCompleteMarkdown(markdown);
  }
  if (streamed?.markdown === markdown) {
    return streamed;
  }

  const nextStreamed = describeMarkdown(markdown, streamed);
  setStreamed(nextStreamed);
  return nextStreamed;
};

export type MarkdownStreamBlockProps = {
  content: MarkdownBlockContent;
  components: Components;
  urlTransform: UrlTransform;
};

const MarkdownStreamBlock = memo(function MarkdownStreamBlock(
  props: MarkdownStreamBlockProps,
): ReactElement {
  if (!props.content.hasMath) {
    return <MarkdownPlainBlock {...props} />;
  }
  // React renders the fallback only while the KaTeX module loads.
  return (
    <Suspense fallback={<MarkdownPlainBlock {...props} />}>
      <MarkdownStreamMathBlock {...props} />
    </Suspense>
  );
});

function MarkdownPlainBlock({
  content,
  components,
  urlTransform,
}: MarkdownStreamBlockProps): ReactElement {
  return useMemo(
    () => renderMarkdownBlock(content, components, urlTransform),
    [components, content, urlTransform],
  );
}
