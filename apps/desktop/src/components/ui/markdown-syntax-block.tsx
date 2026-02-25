import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { createMarkdownSyntaxLanguageRegistry } from "./markdown-syntax-language-registry";

type MarkdownSyntaxBlockProps = {
  language: string;
  code: string;
  className?: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
};

const markdownSyntaxLanguageRegistry = createMarkdownSyntaxLanguageRegistry({
  languageAliases: LANGUAGE_ALIASES,
  defaultLanguages: {
    javascript,
    json,
  },
  lazyLanguageLoaders: {
    bash: () => import("react-syntax-highlighter/dist/esm/languages/prism/bash"),
    diff: () => import("react-syntax-highlighter/dist/esm/languages/prism/diff"),
    jsx: () => import("react-syntax-highlighter/dist/esm/languages/prism/jsx"),
    markdown: () => import("react-syntax-highlighter/dist/esm/languages/prism/markdown"),
    rust: () => import("react-syntax-highlighter/dist/esm/languages/prism/rust"),
    tsx: () => import("react-syntax-highlighter/dist/esm/languages/prism/tsx"),
    typescript: () => import("react-syntax-highlighter/dist/esm/languages/prism/typescript"),
    yaml: () => import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
  },
  registerLanguage: (language, grammar) => {
    SyntaxHighlighter.registerLanguage(language, grammar);
  },
});

const SYNTAX_PRE_STYLE: CSSProperties = {
  margin: 0,
  padding: "0.75rem 0.875rem",
  background: "transparent",
  fontSize: "12px",
  lineHeight: 1.45,
};

const SYNTAX_CODE_TAG_STYLE: CSSProperties = {
  fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
};

export default function MarkdownSyntaxBlock({
  language,
  code,
  className,
}: MarkdownSyntaxBlockProps): ReactElement {
  const [, setLanguageRegistrationVersion] = useState(0);
  const normalizedLanguage = markdownSyntaxLanguageRegistry.normalizeLanguage(language);
  const isSupportedLanguage =
    markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage);
  const isLanguageRegistered =
    markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);

  useEffect(() => {
    if (!isSupportedLanguage || isLanguageRegistered) {
      return;
    }

    let isActive = true;

    void markdownSyntaxLanguageRegistry
      .ensureLanguageRegistered(normalizedLanguage)
      .then((didRegister) => {
        if (!isActive || !didRegister) {
          return;
        }

        setLanguageRegistrationVersion((version) => version + 1);
      })
      .catch(() => {
        // Keep rendering fallback <pre> when dynamic language registration fails.
      });

    return () => {
      isActive = false;
    };
  }, [isLanguageRegistered, isSupportedLanguage, normalizedLanguage]);

  if (!isSupportedLanguage || !isLanguageRegistered) {
    return (
      <pre
        className={cn(
          "overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800",
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      className={cn("overflow-x-auto rounded-xl border border-slate-200 bg-slate-50", className)}
    >
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={oneLight}
        customStyle={SYNTAX_PRE_STYLE}
        codeTagProps={{ style: SYNTAX_CODE_TAG_STYLE }}
        PreTag="div"
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
