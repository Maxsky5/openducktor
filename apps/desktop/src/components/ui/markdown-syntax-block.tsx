import { cn } from "@/lib/utils";
import type { CSSProperties, ReactElement } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

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

const SUPPORTED_LANGUAGES = new Set([
  "bash",
  "diff",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "rust",
  "tsx",
  "typescript",
  "yaml",
]);

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("yaml", yaml);

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

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export default function MarkdownSyntaxBlock({
  language,
  code,
  className,
}: MarkdownSyntaxBlockProps): ReactElement {
  const normalizedLanguage = normalizeLanguage(language);
  const isSupportedLanguage = SUPPORTED_LANGUAGES.has(normalizedLanguage);

  if (!isSupportedLanguage) {
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
