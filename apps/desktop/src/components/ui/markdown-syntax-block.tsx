import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { useTheme } from "@/components/theme-provider";
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

type PrismTheme = typeof oneDark;

let cachedOneLightTheme: PrismTheme | null = null;
let oneLightThemePromise: Promise<PrismTheme | null> | null = null;

const loadOneLightTheme = async (): Promise<PrismTheme | null> => {
  if (cachedOneLightTheme) {
    return cachedOneLightTheme;
  }

  if (oneLightThemePromise) {
    return oneLightThemePromise;
  }

  oneLightThemePromise = import("react-syntax-highlighter/dist/esm/styles/prism/one-light")
    .then((module) => {
      cachedOneLightTheme = module.default;
      return module.default;
    })
    .catch((error) => {
      console.error("Failed to lazy-load Prism light theme:", error);
      return null;
    })
    .finally(() => {
      oneLightThemePromise = null;
    });

  return oneLightThemePromise;
};

const useResolvedDark = (): boolean => {
  const { theme } = useTheme();
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export default function MarkdownSyntaxBlock({
  language,
  code,
  className,
}: MarkdownSyntaxBlockProps): ReactElement {
  const [, setLanguageRegistrationVersion] = useState(0);
  const [oneLightTheme, setOneLightTheme] = useState<PrismTheme | null>(() => cachedOneLightTheme);
  const normalizedLanguage = markdownSyntaxLanguageRegistry.normalizeLanguage(language);
  const isSupportedLanguage =
    markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage);
  const isLanguageRegistered =
    markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);
  const isDark = useResolvedDark();

  useEffect(() => {
    if (isDark || oneLightTheme) {
      return;
    }

    let isActive = true;

    void loadOneLightTheme().then((theme) => {
      if (!isActive || !theme) {
        return;
      }

      setOneLightTheme(theme);
    });

    return () => {
      isActive = false;
    };
  }, [isDark, oneLightTheme]);

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
      .then((didRegister) => {
        if (!isActive || !didRegister) {
          return;
        }

        setLanguageRegistrationVersion((version) => version + 1);
      });

    return () => {
      isActive = false;
    };
  }, [normalizedLanguage]);

  if (!isSupportedLanguage || !isLanguageRegistered) {
    return (
      <pre
        className={cn(
          "overflow-x-auto rounded-xl border border-border bg-muted/30 p-3.5 font-mono text-xs leading-relaxed text-foreground",
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}>
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={isDark ? oneDark : (oneLightTheme ?? oneDark)}
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
