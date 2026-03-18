import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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

const findSyntaxNodes = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as unknown) === "mock-syntax-highlighter");

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

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <MarkdownSyntaxBlock language="javascript" code={"const x = 1;\nconsole.log(x);"} />,
      );
    });

    expect(renderer.root.findAllByType("pre")).toHaveLength(1);
    expect(findSyntaxNodes(renderer)).toHaveLength(0);

    await act(flushMicrotasks);

    const nodes = findSyntaxNodes(renderer);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.props.style).toBe(DARK_THEME);
    expect(darkThemeModuleLoadMock).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
  });

  test("renders light syntax theme immediately when theme is light", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MarkdownSyntaxBlock language="javascript" code="const answer = 42;" />);
    });

    const nodes = findSyntaxNodes(renderer);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.props.style).toBe(LIGHT_THEME);
    expect(renderer.root.findAllByType("pre")).toHaveLength(0);
    expect(darkThemeModuleLoadMock).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  test("keeps plain code fallback for unsupported languages", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MarkdownSyntaxBlock language="elixir" code="IO.puts(:hello)" />);
    });

    expect(renderer.root.findAllByType("pre")).toHaveLength(1);
    expect(findSyntaxNodes(renderer)).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  test("upgrades multiple dark blocks from plain code to dark syntax highlighting", async () => {
    currentTheme = "dark";

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <div>
          <MarkdownSyntaxBlock language="javascript" code="const a = 1;" />
          <MarkdownSyntaxBlock language="json" code='{"a":1}' />
        </div>,
      );
    });

    await act(flushMicrotasks);

    const nodes = findSyntaxNodes(renderer);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.props.style).toBe(DARK_THEME);
    expect(nodes[1]?.props.style).toBe(DARK_THEME);

    act(() => {
      renderer.unmount();
    });
  });

  test("surfaces a fallback notice for grammar load failures and clears it after switching away", async () => {
    yamlLanguageShouldFail = true;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MarkdownSyntaxBlock language="yaml" code={"name: OpenDucktor\n"} />);
    });

    await act(flushMicrotasks);

    const fallback = renderer.root.findByProps({ "data-syntax-load-failure": "language" });
    expect(fallback.findByType("p").children.join("")).toContain(
      "Syntax highlighting unavailable: failed to load the yaml grammar (missing yaml grammar)",
    );
    expect(findSyntaxNodes(renderer)).toHaveLength(0);

    act(() => {
      renderer.update(<MarkdownSyntaxBlock language="elixir" code="IO.puts(:hello)" />);
    });

    await act(flushMicrotasks);

    expect(
      renderer.root.findAll((node) => node.props["data-syntax-load-failure"] !== undefined),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType("p")).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });
});
