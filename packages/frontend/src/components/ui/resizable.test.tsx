import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

describe("ResizableHandle", () => {
  test("uses the selected accent for hover affordances", () => {
    const html = renderToStaticMarkup(
      createElement(
        ResizablePanelGroup,
        { direction: "horizontal" },
        createElement(ResizablePanel, { defaultSize: 50 }, "Left"),
        createElement(ResizableHandle, { withHandle: true }),
        createElement(ResizablePanel, { defaultSize: 50 }, "Right"),
      ),
    );

    expect(html).toContain("group-hover:bg-selected-accent");
    expect(html).toContain("group-hover:border-selected-accent");
    expect(html).toContain("group-hover:text-selected-accent");
    expect(html).not.toContain("group-hover:bg-primary");
  });
});
