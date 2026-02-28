import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
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

type PrismTheme = typeof oneLight;

let cachedOneDarkTheme: PrismTheme | null = null;
let oneDarkThemePromise: Promise<PrismTheme | null> | null = null;

const loadOneDarkTheme = async (): Promise<PrismTheme | null> => {
  if (cachedOneDarkTheme) {
    return cachedOneDarkTheme;
  }

  if (oneDarkThemePromise) {
    return oneDarkThemePromise;
  }

  oneDarkThemePromise = import("react-syntax-highlighter/dist/esm/styles/prism/one-dark")
    .then((module) => {
      cachedOneDarkTheme = module.default;
      return module.default;
    })
    .catch((error) => {
      console.error("Failed to lazy-load Prism dark theme:", error);
      return null;
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
  const normalizedLanguage = markdownSyntaxLanguageRegistry.normalizeLanguage(language);
  const isSupportedLanguage =
    markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage);
  const isLanguageRegistered =
    markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);
  const isDark = theme === "dark";

  const renderPlainCodeBlock = (): ReactElement => (
    <pre
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-muted/30 p-3.5 font-mono text-xs leading-relaxed text-foreground",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );

  useEffect(() => {
    if (!isDark || oneDarkTheme) {
      return;
    }

    let isActive = true;

    void loadOneDarkTheme().then((theme) => {
      if (!isActive || !theme) {
        return;
      }

      setOneDarkTheme(theme);
    });

    return () => {
      isActive = false;
    };
  }, [isDark, oneDarkTheme]);

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
    return renderPlainCodeBlock();
  }

  if (isDark && !oneDarkTheme) {
    return renderPlainCodeBlock();
  }

  const syntaxTheme: PrismTheme = isDark ? (oneDarkTheme as PrismTheme) : oneLight;

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
