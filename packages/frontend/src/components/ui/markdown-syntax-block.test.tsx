import { beforeEach, describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import {
  createMarkdownSyntaxBlock,
  type MarkdownSyntaxBlockProps,
  type MarkdownSyntaxLanguageRegistry,
} from "./markdown-syntax-block-core";

enableReactActEnvironment();

type Theme = "dark" | "light";

let currentTheme: Theme;
let grammarLoadFailure: Error | null;
let registeredLanguages: Set<string>;
let MarkdownSyntaxBlock: ComponentType<MarkdownSyntaxBlockProps>;
let darkThemeLoadCount: number;
let darkThemeLoadFailure: Error | null;
let cachedDarkTheme: Theme | null;

const loadDarkTheme = async () => {
  darkThemeLoadCount += 1;
  if (darkThemeLoadFailure) {
    return { status: "failed", error: darkThemeLoadFailure } as const;
  }
  cachedDarkTheme = "dark";
  return { status: "loaded", theme: "dark" as const } as const;
};

const createLanguageRegistry = (): MarkdownSyntaxLanguageRegistry => ({
  normalizeLanguage: (language) => language.trim().toLowerCase(),
  isLanguageSupported: (language) =>
    language === "javascript" || language === "json" || language === "yaml",
  isLanguageRegistered: (language) => registeredLanguages.has(language),
  ensureLanguageRegistered: async (language) => {
    if (grammarLoadFailure) {
      return { status: "failed", error: grammarLoadFailure };
    }
    registeredLanguages.add(language);
    return { status: "registered" };
  },
});

const findPlainCodeBlock = (container: HTMLElement): HTMLElement | null =>
  container.querySelector("pre");

beforeEach(() => {
  currentTheme = "light";
  cachedDarkTheme = null;
  darkThemeLoadCount = 0;
  darkThemeLoadFailure = null;
  grammarLoadFailure = null;
  registeredLanguages = new Set(["javascript", "json"]);
  MarkdownSyntaxBlock = createMarkdownSyntaxBlock({
    getCachedDarkTheme: () => cachedDarkTheme,
    languageRegistry: createLanguageRegistry(),
    lightTheme: "light" as const,
    loadDarkTheme,
    renderSyntax: ({ language, code, theme }) => (
      <code data-language={language} data-theme={theme}>
        {code}
      </code>
    ),
    useThemeMode: () => currentTheme,
  });
});

describe("MarkdownSyntaxBlock", () => {
  test("renders plain code first in dark theme, then upgrades to dark syntax highlighting", async () => {
    currentTheme = "dark";
    const rendered = render(
      <MarkdownSyntaxBlock language="javascript" code={"const x = 1;\nconsole.log(x);"} />,
    );

    expect(findPlainCodeBlock(rendered.container)).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(findPlainCodeBlock(rendered.container)).toBeNull();
    expect(rendered.container.querySelector("code")?.dataset.theme).toBe("dark");
    expect(darkThemeLoadCount).toBe(1);
  });

  test("reuses the cached dark theme on a new mount", async () => {
    currentTheme = "dark";
    const firstRender = render(
      <MarkdownSyntaxBlock language="javascript" code="const first = true;" />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    firstRender.unmount();

    const secondRender = render(
      <MarkdownSyntaxBlock language="javascript" code="const second = true;" />,
    );

    expect(findPlainCodeBlock(secondRender.container)).toBeNull();
    expect(secondRender.container.querySelector("code")?.dataset.theme).toBe("dark");
    expect(darkThemeLoadCount).toBe(1);
  });

  test("renders syntax highlighting immediately in light theme", () => {
    const rendered = render(
      <MarkdownSyntaxBlock language="javascript" code="const answer = 42;" />,
    );

    expect(findPlainCodeBlock(rendered.container)).toBeNull();
    expect(rendered.container.querySelector("code")?.dataset.theme).toBe("light");
  });

  test("shows a dark-theme load failure without hiding the code", async () => {
    currentTheme = "dark";
    darkThemeLoadFailure = new Error("missing dark theme");
    const rendered = render(<MarkdownSyntaxBlock language="javascript" code="const x = 1;" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.container.querySelector("pre code")?.textContent).toBe("const x = 1;");
    expect(rendered.container.textContent).toContain(
      "Syntax highlighting unavailable: failed to load the dark Prism theme (missing dark theme)",
    );
  });

  test("keeps plain code for unsupported languages", () => {
    const rendered = render(<MarkdownSyntaxBlock language="elixir" code="IO.puts(:hello)" />);

    expect(findPlainCodeBlock(rendered.container)).not.toBeNull();
    expect(rendered.container.querySelector("pre code")?.textContent).toBe("IO.puts(:hello)");
  });

  test("loads a supported grammar and replaces the plain code fallback", async () => {
    const rendered = render(<MarkdownSyntaxBlock language="yaml" code={"name: OpenDucktor\n"} />);

    expect(findPlainCodeBlock(rendered.container)).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(findPlainCodeBlock(rendered.container)).toBeNull();
    expect(rendered.container.querySelector("code")?.dataset.language).toBe("yaml");
  });

  test("shows the grammar load failure without hiding the code", async () => {
    grammarLoadFailure = new Error("missing yaml grammar");
    const rendered = render(<MarkdownSyntaxBlock language="yaml" code="name: OpenDucktor" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      rendered.container.querySelector('[data-syntax-load-failure="language"]'),
    ).not.toBeNull();
    expect(rendered.container.querySelector("pre code")?.textContent).toBe("name: OpenDucktor");
    expect(rendered.container.textContent).toContain(
      "Syntax highlighting unavailable: failed to load the yaml grammar (missing yaml grammar)",
    );
  });
});
