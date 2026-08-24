import { type CSSProperties, type ReactElement, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type MarkdownSyntaxBlockProps = {
  language: string;
  code: string;
  className?: string;
};

export type MarkdownSyntaxLanguageRegistrationResult =
  | { status: "registered" }
  | { status: "unsupported" }
  | { status: "failed"; error: Error };

export type MarkdownSyntaxLanguageRegistry = {
  normalizeLanguage: (language: string) => string;
  isLanguageSupported: (language: string) => boolean;
  isLanguageRegistered: (language: string) => boolean;
  ensureLanguageRegistered: (language: string) => Promise<MarkdownSyntaxLanguageRegistrationResult>;
};

export type MarkdownSyntaxThemeLoadResult<Theme> =
  | { status: "loaded"; theme: Theme }
  | { status: "failed"; error: Error };

type CreateMarkdownSyntaxBlockArgs<Theme> = {
  languageRegistry: MarkdownSyntaxLanguageRegistry;
  lightTheme: Theme;
  loadDarkTheme: () => Promise<MarkdownSyntaxThemeLoadResult<Theme>>;
  renderSyntax: (props: { language: string; code: string; theme: Theme }) => ReactElement;
  useThemeMode: () => "dark" | "light";
};

type MarkdownSyntaxLoadFailure = {
  message: string;
};

type MarkdownSyntaxBlockState<Theme> = {
  languageRegistrationVersion: number;
  darkTheme: Theme | null;
  themeLoadFailure: MarkdownSyntaxLoadFailure | null;
  grammarLoadFailure: MarkdownSyntaxLoadFailure | null;
};

type MarkdownSyntaxBlockAction<Theme> =
  | { type: "theme_reset" }
  | { type: "theme_loaded"; theme: Theme }
  | { type: "theme_failed"; message: string }
  | { type: "grammar_reset" }
  | { type: "grammar_loaded" }
  | { type: "grammar_failed"; message: string };

const markdownSyntaxBlockReducer = <Theme,>(
  state: MarkdownSyntaxBlockState<Theme>,
  action: MarkdownSyntaxBlockAction<Theme>,
): MarkdownSyntaxBlockState<Theme> => {
  switch (action.type) {
    case "theme_reset":
      return state.themeLoadFailure ? { ...state, themeLoadFailure: null } : state;
    case "theme_loaded":
      return { ...state, darkTheme: action.theme, themeLoadFailure: null };
    case "theme_failed":
      return { ...state, themeLoadFailure: { message: action.message } };
    case "grammar_reset":
      return state.grammarLoadFailure ? { ...state, grammarLoadFailure: null } : state;
    case "grammar_loaded":
      return {
        ...state,
        languageRegistrationVersion: state.languageRegistrationVersion + 1,
        grammarLoadFailure: null,
      };
    case "grammar_failed":
      return { ...state, grammarLoadFailure: { message: action.message } };
  }
};

export const createMarkdownSyntaxBlock = <Theme,>({
  languageRegistry,
  lightTheme,
  loadDarkTheme,
  renderSyntax,
  useThemeMode,
}: CreateMarkdownSyntaxBlockArgs<Theme>) =>
  function MarkdownSyntaxBlock({
    language,
    code,
    className,
  }: MarkdownSyntaxBlockProps): ReactElement {
    const themeMode = useThemeMode();
    const [{ darkTheme, themeLoadFailure, grammarLoadFailure }, dispatch] = useReducer(
      markdownSyntaxBlockReducer<Theme>,
      {
        languageRegistrationVersion: 0,
        darkTheme: null,
        themeLoadFailure: null,
        grammarLoadFailure: null,
      },
    );
    const normalizedLanguage = languageRegistry.normalizeLanguage(language);
    const previousNormalizedLanguageRef = useRef(normalizedLanguage);
    const isSupportedLanguage = languageRegistry.isLanguageSupported(normalizedLanguage);
    const isLanguageRegistered = languageRegistry.isLanguageRegistered(normalizedLanguage);
    const isDark = themeMode === "dark";
    const loadFailure = themeLoadFailure ?? grammarLoadFailure;
    let loadFailureKind: "theme" | "language" | undefined;
    if (themeLoadFailure) {
      loadFailureKind = "theme";
    } else if (grammarLoadFailure) {
      loadFailureKind = "language";
    }

    useEffect(() => {
      if (!isDark || darkTheme) {
        dispatch({ type: "theme_reset" });
        return;
      }

      let isActive = true;
      void loadDarkTheme().then((result) => {
        if (!isActive) return;
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
    }, [darkTheme, isDark]);

    useEffect(() => {
      if (previousNormalizedLanguageRef.current !== normalizedLanguage) {
        previousNormalizedLanguageRef.current = normalizedLanguage;
        dispatch({ type: "grammar_reset" });
      }
    }, [normalizedLanguage]);

    useEffect(() => {
      const shouldRegisterLanguage =
        languageRegistry.isLanguageSupported(normalizedLanguage) &&
        !languageRegistry.isLanguageRegistered(normalizedLanguage);
      if (!shouldRegisterLanguage) return;

      let isActive = true;
      void languageRegistry.ensureLanguageRegistered(normalizedLanguage).then((result) => {
        if (!isActive) return;
        if (result.status === "failed") {
          dispatch({
            type: "grammar_failed",
            message: `failed to load the ${normalizedLanguage} grammar (${errorMessage(result.error)})`,
          });
          return;
        }
        if (result.status === "registered") {
          dispatch({ type: "grammar_loaded" });
        }
      });

      return () => {
        isActive = false;
      };
    }, [normalizedLanguage]);

    if (!isSupportedLanguage || !isLanguageRegistered) {
      return (
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
    }

    const syntaxTheme = isDark ? darkTheme : lightTheme;
    if (!syntaxTheme) {
      return (
        <div
          className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}
        >
          <pre className="p-3.5 font-mono text-xs leading-relaxed text-foreground">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    return (
      <div className={cn("overflow-x-auto rounded-xl border border-border bg-muted/30", className)}>
        {renderSyntax({ language: normalizedLanguage, code, theme: syntaxTheme })}
      </div>
    );
  };

export const MARKDOWN_SYNTAX_PRE_STYLE: CSSProperties = {
  margin: 0,
  padding: "0.75rem 0.875rem",
  background: "transparent",
  fontSize: "12px",
  lineHeight: 1.45,
};

export const MARKDOWN_SYNTAX_CODE_TAG_STYLE: CSSProperties = {
  fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, Monaco, Consolas, monospace',
};
