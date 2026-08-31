import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStudioRouteLoadingSkeleton } from "./agent-studio-route-loading-skeleton";

describe("AgentStudioRouteLoadingSkeleton", () => {
  test("renders a labeled Agent Studio layout skeleton without raw loading text", () => {
    const html = renderToStaticMarkup(<AgentStudioRouteLoadingSkeleton />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading Agent Studio"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("border-border");
    expect(html).toContain("bg-card");
    expect(html).not.toContain("Loading page");
  });
});
