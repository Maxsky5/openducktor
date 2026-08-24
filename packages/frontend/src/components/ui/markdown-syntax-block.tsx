import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import { useTheme } from "@/components/layout/theme-provider";
import {
  createMarkdownSyntaxBlock,
  MARKDOWN_SYNTAX_CODE_TAG_STYLE,
  MARKDOWN_SYNTAX_PRE_STYLE,
  type MarkdownSyntaxThemeLoadResult,
} from "./markdown-syntax-block-core";
import { createMarkdownSyntaxLanguageRegistry } from "./markdown-syntax-language-registry";

const LANGUAGE_ALIASES = {
  cjs: "javascript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
} satisfies Record<string, string>;

const markdownSyntaxLanguageRegistry = createMarkdownSyntaxLanguageRegistry({
  languageAliases: LANGUAGE_ALIASES,
  defaultLanguages: { javascript, json },
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

type PrismTheme = typeof oneLight;
let cachedOneDarkTheme: PrismTheme | null = null;
let oneDarkThemePromise: Promise<MarkdownSyntaxThemeLoadResult<PrismTheme>> | null = null;

const loadOneDarkTheme = async (): Promise<MarkdownSyntaxThemeLoadResult<PrismTheme>> => {
  if (cachedOneDarkTheme) {
    return { status: "loaded", theme: cachedOneDarkTheme };
  }
  if (oneDarkThemePromise) {
    return oneDarkThemePromise;
  }

  oneDarkThemePromise = import("react-syntax-highlighter/dist/esm/styles/prism/one-dark")
    .then((module) => {
      cachedOneDarkTheme = module.default;
      return { status: "loaded", theme: module.default } as const;
    })
    .catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error("Failed to lazy-load Prism dark theme:", error);
      return { status: "failed", error } as const;
    })
    .finally(() => {
      oneDarkThemePromise = null;
    });

  return oneDarkThemePromise;
};

const MarkdownSyntaxBlock = createMarkdownSyntaxBlock({
  languageRegistry: markdownSyntaxLanguageRegistry,
  lightTheme: oneLight,
  loadDarkTheme: loadOneDarkTheme,
  renderSyntax: ({ language, code, theme }) => (
    <SyntaxHighlighter
      language={language}
      style={theme}
      customStyle={MARKDOWN_SYNTAX_PRE_STYLE}
      codeTagProps={{ style: MARKDOWN_SYNTAX_CODE_TAG_STYLE }}
      PreTag="div"
      wrapLongLines={false}
    >
      {code}
    </SyntaxHighlighter>
  ),
  useThemeMode: () => useTheme().theme,
});

export default MarkdownSyntaxBlock;
