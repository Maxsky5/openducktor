import {
  type ComponentProps,
  lazy,
  memo,
  type ReactElement,
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
} from "react";
import Markdown, {
  type Components,
  defaultUrlTransform,
  type ExtraProps,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import type { MarkdownPremiumRendererProps } from "./markdown-renderer";

const MarkdownSyntaxBlock = lazy(() => import("./markdown-syntax-block"));

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_URL_TRANSFORM: UrlTransform = (url) => defaultUrlTransform(url);
const LANGUAGE_CLASS_PATTERN = /language-([a-z0-9-]+)/i;
type CodeOverrideProps = ComponentProps<"code"> & ExtraProps;

function createPlainCodeFallback(code: string): ReactElement {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-3.5 shadow-inner">
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
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const stableCodeOverride = useCallback(
    ({ node: _node, className, children, ...props }: CodeOverrideProps): ReactElement => {
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
        <Suspense fallback={fallbackRef.current ?? createPlainCodeFallback(code)}>
          <MarkdownSyntaxBlock language={languageMatch[1]} code={code} />
        </Suspense>
      );
    },
    [],
  );

  const enhancedComponents = useMemo<Components>(
    () => ({
      ...components,
      code: stableCodeOverride,
    }),
    [components, stableCodeOverride],
  );

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
