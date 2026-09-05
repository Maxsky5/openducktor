import { markdownLinkUrlTransform } from "./markdown-link-policy";
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
  linkPolicy,
  fallback,
}: MarkdownPremiumRendererProps): ReactElement {
  const deferredMarkdown = useDeferredValue(markdown);
  const enhancedComponents = usePremiumCodeComponents({ components, enabled: true, fallback });

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      skipHtml
      urlTransform={markdownLinkUrlTransform(MARKDOWN_URL_TRANSFORM, linkPolicy)}
      components={enhancedComponents}
    >
      {deferredMarkdown}
    </Markdown>
  );
});

export default PremiumMarkdownRenderer;
