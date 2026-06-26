import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, lazy, type ReactElement, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SidebarNavigation } from "./sidebar-navigation";
import { sidebarNavLinkClassName } from "./sidebar-navigation-styles";

type RoutePath = "/agents" | "/kanban";

const createSuspendedRoute = () =>
  lazy(() => new Promise<{ default: () => ReactElement }>(() => {}));

function CurrentRouteProbe(): ReactElement {
  const location = useLocation();

  return <output aria-label="Current route">{location.pathname}</output>;
}

const routeTestId = (route: RoutePath): string => `${route.slice(1)}-route`;

function renderSidebarWithSuspendedTarget(
  initialRoute: RoutePath,
  suspendedRoute: RoutePath,
): void {
  const SuspendedRoute = createSuspendedRoute();

  const routeElement = (route: RoutePath): ReactElement => {
    if (route === suspendedRoute) {
      return <SuspendedRoute />;
    }

    return <div data-testid={routeTestId(route)} />;
  };

  render(
    <MemoryRouter initialEntries={[initialRoute]} useTransitions>
      <SidebarNavigation hasActiveWorkspace />
      <CurrentRouteProbe />
      <Suspense fallback={<div data-testid="route-loading" />}>
        <Routes>
          <Route path="/kanban" element={routeElement("/kanban")} />
          <Route path="/agents" element={routeElement("/agents")} />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );
}

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
    expect(html).toContain("gap-2");
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
    expect(html).not.toContain("gap-2");
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

  test("uses selected styles while navigation is activated", () => {
    const className = sidebarNavLinkClassName({
      compact: false,
      isActive: false,
      isActivated: true,
      isDisabled: false,
    });

    expect(className).toContain("bg-sidebar-accent");
    expect(className).toContain("text-sidebar-accent-foreground");
    expect(className).not.toContain("hover:bg-accent");
  });

  test("shows Agents as selected immediately while declarative routing to Agents is still suspended", () => {
    renderSidebarWithSuspendedTarget("/kanban", "/agents");

    fireEvent.click(screen.getByRole("link", { name: "Agents" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/kanban");
    expect(screen.getByTestId("kanban-route")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" }).className).toContain("bg-sidebar-accent");
  });

  test("shows Kanban as selected immediately while declarative routing to Kanban is still suspended", () => {
    renderSidebarWithSuspendedTarget("/agents", "/kanban");

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/agents");
    expect(screen.getByTestId("agents-route")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kanban" }).className).toContain("bg-sidebar-accent");
  });
});
