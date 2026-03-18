import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import { useTheme } from "@/components/layout/theme-provider";
import { errorMessage } from "@/lib/errors";
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

type PrismTheme = typeof oneLight;
type MarkdownSyntaxLoadFailure = {
  kind: "language" | "theme";
  message: string;
};
type ThemeLoadResult = { status: "loaded"; theme: PrismTheme } | { status: "failed"; error: Error };

let cachedOneDarkTheme: PrismTheme | null = null;
let oneDarkThemePromise: Promise<ThemeLoadResult> | null = null;

const loadOneDarkTheme = async (): Promise<ThemeLoadResult> => {
  if (cachedOneDarkTheme) {
    return {
      status: "loaded",
      theme: cachedOneDarkTheme,
    };
  }

  if (oneDarkThemePromise) {
    return oneDarkThemePromise;
  }

  oneDarkThemePromise = import("react-syntax-highlighter/dist/esm/styles/prism/one-dark")
    .then((module) => {
      cachedOneDarkTheme = module.default;
      return {
        status: "loaded",
        theme: module.default,
      } as const;
    })
    .catch((error) => {
      const failure =
        error instanceof Error ? error : new Error(String(error ?? "Unknown theme loader error"));
      console.error("Failed to lazy-load Prism dark theme:", failure);
      return {
        status: "failed",
        error: failure,
      } as const;
    })
    .finally(() => {
      oneDarkThemePromise = null;
    });

  return oneDarkThemePromise;
};

export default function MarkdownSyntaxBlock({
  language,
  code,
  className,
}: MarkdownSyntaxBlockProps): ReactElement {
  const { theme } = useTheme();
  const [, setLanguageRegistrationVersion] = useState(0);
  const [oneDarkTheme, setOneDarkTheme] = useState<PrismTheme | null>(() => cachedOneDarkTheme);
  const [loadFailure, setLoadFailure] = useState<MarkdownSyntaxLoadFailure | null>(null);
  const normalizedLanguage = markdownSyntaxLanguageRegistry.normalizeLanguage(language);
  const isSupportedLanguage =
    markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage);
  const isLanguageRegistered =
    markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);
  const isDark = theme === "dark";

  const renderPlainCodeBlock = (): ReactElement => (
    <div
      className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}
      data-syntax-load-failure={loadFailure?.kind ?? undefined}
    >
      <pre className="p-3.5 font-mono text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
      {loadFailure ? (
        <p className="border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
          Syntax highlighting unavailable: {loadFailure.message}
        </p>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (!isDark) {
      setLoadFailure((current) => (current?.kind === "theme" ? null : current));
      return;
    }

    if (oneDarkTheme) {
      setLoadFailure((current) => (current?.kind === "theme" ? null : current));
      return;
    }

    let isActive = true;

    void loadOneDarkTheme().then((result) => {
      if (!isActive) {
        return;
      }

      if (result.status === "failed") {
        setLoadFailure({
          kind: "theme",
          message: `failed to load the dark Prism theme (${errorMessage(result.error)})`,
        });
        return;
      }

      setLoadFailure((current) => (current?.kind === "theme" ? null : current));
      setOneDarkTheme(result.theme);
    });

    return () => {
      isActive = false;
    };
  }, [isDark, oneDarkTheme]);

  useEffect(() => {
    if (!isSupportedLanguage || isLanguageRegistered) {
      setLoadFailure((current) => (current?.kind === "language" ? null : current));
    }
  }, [isLanguageRegistered, isSupportedLanguage]);

  useEffect(() => {
    const shouldRegisterLanguage =
      markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage) &&
      !markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);

    if (!shouldRegisterLanguage) {
      return;
    }

    let isActive = true;

    void markdownSyntaxLanguageRegistry
      .ensureLanguageRegistered(normalizedLanguage)
      .then((result) => {
        if (!isActive) {
          return;
        }

        if (result.status === "failed") {
          setLoadFailure({
            kind: "language",
            message: `failed to load the ${normalizedLanguage} grammar (${errorMessage(result.error)})`,
          });
          return;
        }

        if (result.status !== "registered") {
          return;
        }

        setLoadFailure((current) => (current?.kind === "language" ? null : current));
        setLanguageRegistrationVersion((version) => version + 1);
      });

    return () => {
      isActive = false;
    };
  }, [normalizedLanguage]);

  if (!isSupportedLanguage || !isLanguageRegistered) {
    return renderPlainCodeBlock();
  }

  const syntaxTheme = isDark ? oneDarkTheme : oneLight;
  if (!syntaxTheme) {
    return renderPlainCodeBlock();
  }

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}>
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={syntaxTheme}
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
