import { describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import type { Components } from "react-markdown";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import PremiumMarkdownRenderer from "./markdown-renderer-premium";

enableReactActEnvironment();

describe("PremiumMarkdownRenderer", () => {
  test("renders updated markdown when the fallback changes", async () => {
    const rendered = render(
      <PremiumMarkdownRenderer
        markdown="**alpha**"
        components={{}}
        fallback={<span>Loading alpha</span>}
      />,
    );
    try {
      expect(rendered.container.querySelector("strong")?.textContent).toBe("alpha");

      rendered.rerender(
        <PremiumMarkdownRenderer
          markdown="**beta**"
          components={{}}
          fallback={<span>Loading beta</span>}
        />,
      );

      await waitFor(() => {
        expect(rendered.container.querySelector("strong")?.textContent).toBe("beta");
      });
    } finally {
      rendered.unmount();
    }
  });

  test("uses the latest component overrides", async () => {
    const componentsA: Components = {
      strong: ({ node: _node, ...props }) => <strong data-variant="a" {...props} />,
    };
    const componentsB: Components = {
      strong: ({ node: _node, ...props }) => <strong data-variant="b" {...props} />,
    };
    const rendered = render(
      <PremiumMarkdownRenderer markdown="**alpha**" components={componentsA} />,
    );

    try {
      expect(rendered.container.querySelector("strong")?.dataset.variant).toBe("a");
      rendered.rerender(<PremiumMarkdownRenderer markdown="**alpha**" components={componentsB} />);

      await waitFor(() => {
        expect(rendered.container.querySelector("strong")?.dataset.variant).toBe("b");
      });
    } finally {
      rendered.unmount();
    }
  });
});
