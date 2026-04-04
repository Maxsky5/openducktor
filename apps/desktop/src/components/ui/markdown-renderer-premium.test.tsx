import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";

enableReactActEnvironment();

const markdownRenderMock = mock((_props: Record<string, unknown>) => {});

mock.module("react-markdown", () => {
  const MockMarkdown = ({
    children,
    ...props
  }: Record<string, unknown> & {
    children?: unknown;
  }): ReactElement => {
    markdownRenderMock(props);
    return createElement("mock-react-markdown", props, children as ReactNode);
  };

  return {
    __esModule: true,
    default: MockMarkdown,
    defaultUrlTransform: (url: string) => url,
  };
});

type PremiumMarkdownRendererComponent = typeof import("./markdown-renderer-premium").default;
let PremiumMarkdownRenderer: PremiumMarkdownRendererComponent;

const getLatestComponentsProp = (): Components => {
  const latest = markdownRenderMock.mock.calls.at(-1)?.[0] as
    | { components?: Components }
    | undefined;
  const components = latest?.components;
  if (!components) {
    throw new Error("Expected react-markdown to receive components");
  }
  return components;
};

beforeAll(async () => {
  ({ default: PremiumMarkdownRenderer } = await import("./markdown-renderer-premium"));
});

beforeEach(() => {
  markdownRenderMock.mockClear();
});

describe("PremiumMarkdownRenderer memoization", () => {
  test("keeps enhanced components reference stable when markdown or fallback changes", async () => {
    const components: Components = {};
    const rendered = render(
      <PremiumMarkdownRenderer
        markdown="alpha"
        components={components}
        fallback={<span>Loading alpha</span>}
      />,
    );

    const firstReference = getLatestComponentsProp();

    rendered.rerender(
      <PremiumMarkdownRenderer
        markdown="beta"
        components={components}
        fallback={<span>Loading beta</span>}
      />,
    );

    const secondReference = getLatestComponentsProp();
    expect(secondReference).toBe(firstReference);

    rendered.unmount();
  });

  test("rebuilds enhanced components when base components prop changes", async () => {
    const componentsA: Components = {};
    const componentsB: Components = {
      strong: ({ node: _node, ...props }) => <strong {...props} />,
    };

    const rendered = render(<PremiumMarkdownRenderer markdown="alpha" components={componentsA} />);

    const firstReference = getLatestComponentsProp();

    rendered.rerender(<PremiumMarkdownRenderer markdown="alpha" components={componentsB} />);

    const secondReference = getLatestComponentsProp();
    expect(secondReference).not.toBe(firstReference);

    rendered.unmount();
  });
});
