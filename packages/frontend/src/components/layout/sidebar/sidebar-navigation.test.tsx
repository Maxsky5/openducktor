import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, lazy, type MouseEvent, type ReactElement, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { SidebarNavigation } from "./sidebar-navigation";
import { sidebarNavLinkClassName } from "./sidebar-navigation-styles";

type RoutePath = "/agents" | "/kanban";

const createSuspendedRoute = () =>
  lazy(() => new Promise<{ default: () => ReactElement }>(() => {}));

function CurrentRouteProbe(): ReactElement {
  const location = useLocation();

  return <output aria-label="Current route">{location.pathname}</output>;
}

function BackButton(): ReactElement {
  const navigate = useNavigate();

  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

const routeTestId = (route: RoutePath): string => `${route.slice(1)}-route`;

const MODIFIED_CLICK_CASES = [
  { label: "Alt", eventInit: { altKey: true } },
  { label: "Control", eventInit: { ctrlKey: true } },
  { label: "Meta", eventInit: { metaKey: true } },
  { label: "Shift", eventInit: { shiftKey: true } },
] as const;

type RenderSidebarRoutingScenarioOptions = {
  initialRoute: RoutePath;
  onSidebarClickCapture?: (event: MouseEvent<HTMLDivElement>) => void;
  suspendedRoute?: RoutePath;
};

function renderSidebarRoutingScenario({
  initialRoute,
  onSidebarClickCapture,
  suspendedRoute,
}: RenderSidebarRoutingScenarioOptions): void {
  const SuspendedRoute = suspendedRoute ? createSuspendedRoute() : null;

  const routeElement = (route: RoutePath): ReactElement => {
    if (route === suspendedRoute) {
      if (!SuspendedRoute) {
        throw new Error(`Missing suspended route component for ${route}`);
      }

      return <SuspendedRoute />;
    }

    return <div data-testid={routeTestId(route)} />;
  };

  render(
    <MemoryRouter initialEntries={[initialRoute]} useTransitions>
      <div onClickCapture={onSidebarClickCapture}>
        <SidebarNavigation hasActiveWorkspace />
      </div>
      <BackButton />
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
    renderSidebarRoutingScenario({ initialRoute: "/kanban", suspendedRoute: "/agents" });

    fireEvent.click(screen.getByRole("link", { name: "Agents" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/kanban");
    expect(screen.getByTestId("kanban-route")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" }).className).toContain("bg-sidebar-accent");
  });

  test("shows Kanban as selected immediately while declarative routing to Kanban is still suspended", () => {
    renderSidebarRoutingScenario({ initialRoute: "/agents", suspendedRoute: "/kanban" });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/agents");
    expect(screen.getByTestId("agents-route")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kanban" }).className).toContain("bg-sidebar-accent");
  });

  for (const modifiedClickCase of MODIFIED_CLICK_CASES) {
    test(`does not show optimistic selection for ${modifiedClickCase.label} clicks handled by the browser`, () => {
      renderSidebarRoutingScenario({ initialRoute: "/kanban", suspendedRoute: "/agents" });

      fireEvent.click(screen.getByRole("link", { name: "Agents" }), modifiedClickCase.eventInit);

      expect(screen.getByLabelText("Current route").textContent).toBe("/kanban");
      expect(screen.getByRole("link", { name: "Agents" }).className).not.toContain(
        "bg-sidebar-accent",
      );
    });
  }

  test("does not show optimistic selection for non-left clicks handled by the browser", () => {
    renderSidebarRoutingScenario({ initialRoute: "/kanban", suspendedRoute: "/agents" });

    fireEvent.click(screen.getByRole("link", { name: "Agents" }), { button: 1 });

    expect(screen.getByLabelText("Current route").textContent).toBe("/kanban");
    expect(screen.getByRole("link", { name: "Agents" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });

  test("does not show optimistic selection when another handler prevents navigation", () => {
    renderSidebarRoutingScenario({
      initialRoute: "/kanban",
      onSidebarClickCapture: (event) => event.preventDefault(),
      suspendedRoute: "/agents",
    });

    fireEvent.click(screen.getByRole("link", { name: "Agents" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/kanban");
    expect(screen.getByRole("link", { name: "Agents" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });

  test("keeps focus when route commit replaces optimistic selection with active selection", async () => {
    renderSidebarRoutingScenario({ initialRoute: "/kanban" });

    const agentsLink = screen.getByRole("link", { name: "Agents" });
    agentsLink.focus();
    fireEvent.click(agentsLink);

    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/agents"));

    expect(agentsLink.isConnected).toBe(true);
    expect(document.activeElement).toBe(agentsLink);
    expect(agentsLink.className).toContain("bg-sidebar-accent");
  });

  test("does not revive stale optimistic selection after browser back restores the source entry", async () => {
    renderSidebarRoutingScenario({ initialRoute: "/kanban" });

    fireEvent.click(screen.getByRole("link", { name: "Agents" }));
    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/agents"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/kanban"));

    expect(screen.getByRole("link", { name: "Kanban" }).className).toContain("bg-sidebar-accent");
    expect(screen.getByRole("link", { name: "Agents" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });
});
