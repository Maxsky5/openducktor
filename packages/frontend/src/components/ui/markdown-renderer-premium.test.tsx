import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const actualReactMarkdownModule = await import("react-markdown");
const markdownRenderMock = mock((_props: Record<string, unknown>) => {});

const createReactMarkdownMockModule = () => {
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
};

type PremiumMarkdownRendererComponent = typeof import("./markdown-renderer-premium").default;
let premiumMarkdownRendererImportCounter = 0;

const importFreshPremiumMarkdownRenderer = async (): Promise<PremiumMarkdownRendererComponent> => {
  premiumMarkdownRendererImportCounter += 1;
  const module = (await import(
    `./markdown-renderer-premium?mock=${premiumMarkdownRendererImportCounter}`
  )) as {
    default: PremiumMarkdownRendererComponent;
  };
  return module.default;
};

const withMockedReactMarkdown = async (
  runTest: (PremiumMarkdownRenderer: PremiumMarkdownRendererComponent) => void | Promise<void>,
): Promise<void> => {
  markdownRenderMock.mockClear();
  mock.module("react-markdown", createReactMarkdownMockModule);

  try {
    const PremiumMarkdownRenderer = await importFreshPremiumMarkdownRenderer();
    await runTest(PremiumMarkdownRenderer);
  } finally {
    await restoreMockedModules([["react-markdown", async () => actualReactMarkdownModule]]);
  }
};

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

describe("PremiumMarkdownRenderer memoization", () => {
  test("keeps enhanced components reference stable when markdown or fallback changes", async () => {
    await withMockedReactMarkdown((PremiumMarkdownRenderer) => {
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
  });

  test("rebuilds enhanced components when base components prop changes", async () => {
    await withMockedReactMarkdown((PremiumMarkdownRenderer) => {
      const componentsA: Components = {};
      const componentsB: Components = {
        strong: ({ node: _node, ...props }) => <strong {...props} />,
      };

      const rendered = render(
        <PremiumMarkdownRenderer markdown="alpha" components={componentsA} />,
      );

      const firstReference = getLatestComponentsProp();

      rendered.rerender(<PremiumMarkdownRenderer markdown="alpha" components={componentsB} />);

      const secondReference = getLatestComponentsProp();
      expect(secondReference).not.toBe(firstReference);

      rendered.unmount();
    });
  });
});
