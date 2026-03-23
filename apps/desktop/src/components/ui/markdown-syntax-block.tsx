import { type CSSProperties, type ReactElement, useEffect, useReducer, useRef } from "react";
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
  message: string;
};
type ThemeLoadResult = { status: "loaded"; theme: PrismTheme } | { status: "failed"; error: Error };
type MarkdownSyntaxBlockState = {
  languageRegistrationVersion: number;
  oneDarkTheme: PrismTheme | null;
  themeLoadFailure: MarkdownSyntaxLoadFailure | null;
  grammarLoadFailure: MarkdownSyntaxLoadFailure | null;
};
type MarkdownSyntaxBlockAction =
  | { type: "theme_reset" }
  | { type: "theme_loaded"; theme: PrismTheme }
  | { type: "theme_failed"; message: string }
  | { type: "grammar_reset" }
  | { type: "grammar_loaded" }
  | { type: "grammar_failed"; message: string };

let cachedOneDarkTheme: PrismTheme | null = null;
let oneDarkThemePromise: Promise<ThemeLoadResult> | null = null;

const createInitialState = (): MarkdownSyntaxBlockState => ({
  languageRegistrationVersion: 0,
  oneDarkTheme: cachedOneDarkTheme,
  themeLoadFailure: null,
  grammarLoadFailure: null,
});

const markdownSyntaxBlockReducer = (
  state: MarkdownSyntaxBlockState,
  action: MarkdownSyntaxBlockAction,
): MarkdownSyntaxBlockState => {
  switch (action.type) {
    case "theme_reset":
      return state.themeLoadFailure ? { ...state, themeLoadFailure: null } : state;
    case "theme_loaded":
      return {
        ...state,
        oneDarkTheme: action.theme,
        themeLoadFailure: null,
      };
    case "theme_failed":
      return {
        ...state,
        themeLoadFailure: { message: action.message },
      };
    case "grammar_reset":
      return state.grammarLoadFailure ? { ...state, grammarLoadFailure: null } : state;
    case "grammar_loaded":
      return {
        ...state,
        languageRegistrationVersion: state.languageRegistrationVersion + 1,
        grammarLoadFailure: null,
      };
    case "grammar_failed":
      return {
        ...state,
        grammarLoadFailure: { message: action.message },
      };
    default:
      return state;
  }
};

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
  const [{ oneDarkTheme, themeLoadFailure, grammarLoadFailure }, dispatch] = useReducer(
    markdownSyntaxBlockReducer,
    undefined,
    createInitialState,
  );
  const normalizedLanguage = markdownSyntaxLanguageRegistry.normalizeLanguage(language);
  const previousNormalizedLanguageRef = useRef(normalizedLanguage);
  const isSupportedLanguage =
    markdownSyntaxLanguageRegistry.isLanguageSupported(normalizedLanguage);
  const isLanguageRegistered =
    markdownSyntaxLanguageRegistry.isLanguageRegistered(normalizedLanguage);
  const isDark = theme === "dark";
  const loadFailure = themeLoadFailure ?? grammarLoadFailure;
  const loadFailureKind = themeLoadFailure ? "theme" : grammarLoadFailure ? "language" : undefined;

  const renderPlainCodeBlock = (): ReactElement => (
    <div
      className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}
      data-syntax-load-failure={loadFailureKind}
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
      dispatch({ type: "theme_reset" });
      return;
    }

    if (oneDarkTheme) {
      dispatch({ type: "theme_reset" });
      return;
    }

    let isActive = true;

    void loadOneDarkTheme().then((result) => {
      if (!isActive) {
        return;
      }

      if (result.status === "failed") {
        dispatch({
          type: "theme_failed",
          message: `failed to load the dark Prism theme (${errorMessage(result.error)})`,
        });
        return;
      }

      dispatch({ type: "theme_loaded", theme: result.theme });
    });

    return () => {
      isActive = false;
    };
  }, [isDark, oneDarkTheme]);

  useEffect(() => {
    if (previousNormalizedLanguageRef.current !== normalizedLanguage) {
      previousNormalizedLanguageRef.current = normalizedLanguage;
      dispatch({ type: "grammar_reset" });
    }
  }, [normalizedLanguage]);

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
          dispatch({
            type: "grammar_failed",
            message: `failed to load the ${normalizedLanguage} grammar (${errorMessage(result.error)})`,
          });
          return;
        }

        if (result.status !== "registered") {
          return;
        }

        dispatch({ type: "grammar_loaded" });
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
