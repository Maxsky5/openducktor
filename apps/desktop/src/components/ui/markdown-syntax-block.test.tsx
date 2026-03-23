import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type Theme = "dark" | "light";

const LIGHT_THEME = { themeName: "light" };
const DARK_THEME = { themeName: "dark" };

let currentTheme: Theme = "light";
let yamlLanguageShouldFail = false;
const registerLanguageMock = mock((_language: string, _grammar: unknown) => {});
const syntaxHighlighterRenderMock = mock((_props: Record<string, unknown>) => {});
const darkThemeModuleLoadMock = mock(() => DARK_THEME);

mock.module("@/components/layout/theme-provider", () => ({
  useTheme: () => ({
    theme: currentTheme,
    setTheme: (_theme: Theme) => {},
  }),
}));

mock.module("react-syntax-highlighter", () => {
  const PrismLight = ({
    children,
    ...props
  }: Record<string, unknown> & { children?: ReactElement | string }): ReactElement => {
    syntaxHighlighterRenderMock(props);
    return createElement("mock-syntax-highlighter", props, children);
  };

  PrismLight.registerLanguage = (language: string, grammar: unknown): void => {
    registerLanguageMock(language, grammar);
  };

  return { PrismLight };
});

mock.module("react-syntax-highlighter/dist/esm/languages/prism/javascript", () => ({
  default: { grammar: "javascript" },
}));

mock.module("react-syntax-highlighter/dist/esm/languages/prism/json", () => ({
  default: { grammar: "json" },
}));

mock.module("react-syntax-highlighter/dist/esm/styles/prism/one-light", () => ({
  default: LIGHT_THEME,
}));

mock.module("react-syntax-highlighter/dist/esm/styles/prism/one-dark", () => ({
  default: darkThemeModuleLoadMock(),
}));

mock.module("react-syntax-highlighter/dist/esm/languages/prism/yaml", () => {
  if (yamlLanguageShouldFail) {
    throw new Error("missing yaml grammar");
  }

  return {
    default: { grammar: "yaml" },
  };
});

type MarkdownSyntaxBlockComponent = typeof import("./markdown-syntax-block").default;
let MarkdownSyntaxBlock: MarkdownSyntaxBlockComponent;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const findSyntaxNodes = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll("mock-syntax-highlighter"));

beforeAll(async () => {
  ({ default: MarkdownSyntaxBlock } = await import("./markdown-syntax-block"));
});

beforeEach(() => {
  currentTheme = "light";
  yamlLanguageShouldFail = false;
  syntaxHighlighterRenderMock.mockClear();
  darkThemeModuleLoadMock.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("MarkdownSyntaxBlock", () => {
  test("renders plain code first in dark theme, then upgrades to dark syntax theme", async () => {
    currentTheme = "dark";

    const rendered = render(
      <MarkdownSyntaxBlock language="javascript" code={"const x = 1;\nconsole.log(x);"} />,
    );

    expect(rendered.container.querySelectorAll("pre")).toHaveLength(1);
    expect(findSyntaxNodes(rendered.container)).toHaveLength(0);

    await flushMicrotasks();
    await waitFor(() => expect(findSyntaxNodes(rendered.container)).toHaveLength(1));

    const nodes = findSyntaxNodes(rendered.container);
    expect(nodes).toHaveLength(1);
    expect(syntaxHighlighterRenderMock.mock.calls.at(-1)?.[0]?.style).toBe(DARK_THEME);
    expect(darkThemeModuleLoadMock).toHaveBeenCalledTimes(1);

    rendered.unmount();
  });

  test("renders light syntax theme immediately when theme is light", async () => {
    const rendered = render(
      <MarkdownSyntaxBlock language="javascript" code="const answer = 42;" />,
    );

    const nodes = findSyntaxNodes(rendered.container);
    expect(nodes).toHaveLength(1);
    expect(syntaxHighlighterRenderMock.mock.calls.at(-1)?.[0]?.style).toBe(LIGHT_THEME);
    expect(rendered.container.querySelectorAll("pre")).toHaveLength(0);
    expect(darkThemeModuleLoadMock).not.toHaveBeenCalled();

    rendered.unmount();
  });

  test("keeps plain code fallback for unsupported languages", async () => {
    const rendered = render(<MarkdownSyntaxBlock language="elixir" code="IO.puts(:hello)" />);

    expect(rendered.container.querySelectorAll("pre")).toHaveLength(1);
    expect(findSyntaxNodes(rendered.container)).toHaveLength(0);

    rendered.unmount();
  });

  test("upgrades multiple dark blocks from plain code to dark syntax highlighting", async () => {
    currentTheme = "dark";

    const rendered = render(
      <div>
        <MarkdownSyntaxBlock language="javascript" code="const a = 1;" />
        <MarkdownSyntaxBlock language="json" code='{"a":1}' />
      </div>,
    );

    await flushMicrotasks();
    await waitFor(() => expect(findSyntaxNodes(rendered.container)).toHaveLength(2));

    const nodes = findSyntaxNodes(rendered.container);
    expect(nodes).toHaveLength(2);
    const renderCalls = syntaxHighlighterRenderMock.mock.calls.map((call) => call[0]);
    expect(renderCalls.at(-2)?.style).toBe(DARK_THEME);
    expect(renderCalls.at(-1)?.style).toBe(DARK_THEME);

    rendered.unmount();
  });

  test("surfaces a fallback notice for grammar load failures and clears it after switching away", async () => {
    yamlLanguageShouldFail = true;
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]): void => {
      const [firstArg] = args;
      if (
        typeof firstArg === "string" &&
        firstArg.startsWith("Failed to lazy-load language grammar for 'yaml':")
      ) {
        return;
      }
      originalConsoleError(...args);
    };

    const rendered = render(<MarkdownSyntaxBlock language="yaml" code={"name: OpenDucktor\n"} />);

    try {
      await flushMicrotasks();
      await waitFor(() =>
        expect(
          rendered.container.querySelector('[data-syntax-load-failure="language"]'),
        ).not.toBeNull(),
      );

      const fallback = rendered.container.querySelector('[data-syntax-load-failure="language"]');
      expect(fallback?.textContent).toContain(
        "Syntax highlighting unavailable: failed to load the yaml grammar (missing yaml grammar)",
      );
      expect(findSyntaxNodes(rendered.container)).toHaveLength(0);

      rendered.rerender(<MarkdownSyntaxBlock language="elixir" code="IO.puts(:hello)" />);

      await flushMicrotasks();
      await waitFor(() =>
        expect(rendered.container.querySelectorAll("[data-syntax-load-failure]")).toHaveLength(0),
      );

      expect(rendered.container.querySelectorAll("[data-syntax-load-failure]")).toHaveLength(0);
      expect(rendered.container.querySelectorAll("p")).toHaveLength(0);

      rendered.unmount();
    } finally {
      console.error = originalConsoleError;
    }
  });
});
