import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SidebarNavigation } from "./sidebar-navigation";

describe("SidebarNavigation", () => {
  test("renders text labels in default mode", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(SidebarNavigation, { hasActiveWorkspace: true }),
      ),
    );

    expect(html).toContain("Kanban");
    expect(html).toContain("Agents");
    expect(html).toContain("animate-rise-in");
  });

  test("hides text labels in compact mode but keeps aria labels", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(SidebarNavigation, { hasActiveWorkspace: true, compact: true }),
      ),
    );

    expect(html).toContain('aria-label="Kanban"');
    expect(html).toContain('aria-label="Agents"');
    expect(html).not.toContain("animate-rise-in");
    expect(html).toContain("justify-center");
  });

  test("routes agents navigation to kanban when repository is missing", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/kanban"] },
        createElement(SidebarNavigation, { hasActiveWorkspace: false }),
      ),
    );

    expect(html).toContain('href="/kanban"');
    expect(html).toContain('aria-disabled="true"');
  });
});
