import { memo, type ReactElement, useDeferredValue } from "react";
import Markdown, { defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MarkdownPremiumRendererProps } from "./markdown-renderer";
import { usePremiumCodeComponents } from "./markdown-renderer-premium-code";

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);
const PremiumMarkdownRenderer = memo(function PremiumMarkdownRenderer({
  markdown,
  components,
  fallback,
}: MarkdownPremiumRendererProps): ReactElement {
  const deferredMarkdown = useDeferredValue(markdown);
  const enhancedComponents = usePremiumCodeComponents({ components, enabled: true, fallback });

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      skipHtml
      urlTransform={MARKDOWN_URL_TRANSFORM}
      components={enhancedComponents}
    >
      {deferredMarkdown}
    </Markdown>
  );
});

export default PremiumMarkdownRenderer;
