import { lazy, memo, type ReactElement, Suspense, useDeferredValue } from "react";
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MarkdownPremiumRendererProps } from "./markdown-renderer";

const MarkdownSyntaxBlock = lazy(() => import("./markdown-syntax-block"));

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);
const LANGUAGE_CLASS_PATTERN = /language-([a-z0-9-]+)/i;

function createPlainCodeFallback(code: string): ReactElement {
  return (
    <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/90 p-3.5 shadow-inner">
      <code>{code}</code>
    </pre>
  );
}

const PremiumMarkdownRenderer = memo(function PremiumMarkdownRenderer({
  markdown,
  components,
  fallback,
}: MarkdownPremiumRendererProps): ReactElement {
  const deferredMarkdown = useDeferredValue(markdown);

  const enhancedComponents: Components = {
    ...components,
    code: ({ node: _node, className, children, ...props }) => {
      const languageMatch = LANGUAGE_CLASS_PATTERN.exec(className ?? "");
      const rawCode = String(children);
      const code = rawCode.endsWith("\n") ? rawCode.slice(0, -1) : rawCode;

      if (!languageMatch?.[1]) {
        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      }

      return (
        <Suspense fallback={fallback ?? createPlainCodeFallback(code)}>
          <MarkdownSyntaxBlock language={languageMatch[1]} code={code} />
        </Suspense>
      );
    },
  };

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
