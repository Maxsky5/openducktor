import {
  type ComponentProps,
  type ComponentType,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
} from "react";
import type { Components, ExtraProps } from "react-markdown";

const MarkdownSyntaxBlock = lazy(() => import("./markdown-syntax-block"));

const LANGUAGE_CLASS_PATTERN = /language-([a-z0-9-]+)/i;
type CodeOverrideProps = ComponentProps<"code"> & ExtraProps;

function createPlainCodeFallback(code: string): ReactElement {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-3.5 shadow-inner">
      <code>{code}</code>
    </pre>
  );
}

export const usePremiumCodeComponents = ({
  components,
  enabled,
  fallback,
}: {
  components: Components;
  enabled: boolean;
  fallback?: ReactNode;
}): Components => {
  const codeOverride = useCallback(
    ({ node: _node, className, children, ...props }: CodeOverrideProps): ReactElement => {
      const languageMatch = LANGUAGE_CLASS_PATTERN.exec(className ?? "");
      // SAFETY: The surrounding boundary constructs or validates every member required by `ComponentType<CodeOverrideProps> | undefined`.
      const codeComponent = components.code as ComponentType<CodeOverrideProps> | undefined;
      if (!languageMatch?.[1]) {
        if (codeComponent) {
          const CodeComponent = codeComponent;
          return (
            <CodeComponent {...props} className={className}>
              {children}
            </CodeComponent>
          );
        }
        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      }

      const rawCode = String(children);
      const code = rawCode.endsWith("\n") ? rawCode.slice(0, -1) : rawCode;
      return (
        <Suspense fallback={fallback ?? createPlainCodeFallback(code)}>
          <MarkdownSyntaxBlock language={languageMatch[1]} code={code} />
        </Suspense>
      );
    },
    [components.code, fallback],
  );

  return useMemo(
    () => (enabled ? { ...components, code: codeOverride } : components),
    [codeOverride, components, enabled],
  );
};
