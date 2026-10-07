import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { lazy, type MouseEvent, type ReactElement, Suspense } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { SidebarNavigation } from "./sidebar-navigation";

type RoutePath = "/sessions" | "/kanban";

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
  onBeforeNavigate?: (apply: () => void, cancel?: () => void) => void;
  onSidebarClickCapture?: (event: MouseEvent<HTMLDivElement>) => void;
  suspendedRoute?: RoutePath;
};

function renderSidebarRoutingScenario({
  initialRoute,
  onBeforeNavigate,
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
        <SidebarNavigation {...(onBeforeNavigate ? { onBeforeNavigate } : {})} />
      </div>
      <BackButton />
      <CurrentRouteProbe />
      <Suspense fallback={<div data-testid="route-loading" />}>
        <Routes>
          <Route path="/kanban" element={routeElement("/kanban")} />
          <Route path="/sessions" element={routeElement("/sessions")} />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );
}

describe("SidebarNavigation", () => {
  test("clears the link highlight when the guard cancels at once", () => {
    renderSidebarRoutingScenario({
      initialRoute: "/sessions",
      onBeforeNavigate: (_apply, cancel) => cancel?.(),
    });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
    expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });

  test.each([
    ["expanded", false, "Kanban"],
    ["collapsed", true, ""],
  ] as const)("keeps an accessible Kanban link with %s sidebar labels", (_mode, compact, text) => {
    render(
      <MemoryRouter initialEntries={["/kanban"]}>
        <SidebarNavigation compact={compact} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Kanban" }).textContent).toBe(text);
  });

  test("shows Kanban as selected immediately while declarative routing to Kanban is still suspended", () => {
    renderSidebarRoutingScenario({ initialRoute: "/sessions", suspendedRoute: "/kanban" });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
    expect(screen.getByTestId("sessions-route")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kanban" }).className).toContain("bg-sidebar-accent");
    expect(screen.getByRole("link", { name: "Kanban" }).className).toContain(
      "text-sidebar-accent-foreground",
    );
    expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain("hover:bg-accent");
  });

  for (const modifiedClickCase of MODIFIED_CLICK_CASES) {
    test(`does not show optimistic selection for ${modifiedClickCase.label} clicks handled by the browser`, () => {
      renderSidebarRoutingScenario({ initialRoute: "/sessions", suspendedRoute: "/kanban" });

      fireEvent.click(screen.getByRole("link", { name: "Kanban" }), modifiedClickCase.eventInit);

      expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
      expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain(
        "bg-sidebar-accent",
      );
    });
  }

  test("does not show optimistic selection for non-left clicks handled by the browser", () => {
    renderSidebarRoutingScenario({ initialRoute: "/sessions", suspendedRoute: "/kanban" });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }), { button: 1 });

    expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
    expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });

  test("does not show optimistic selection when another handler prevents navigation", () => {
    renderSidebarRoutingScenario({
      initialRoute: "/sessions",
      onSidebarClickCapture: (event) => event.preventDefault(),
      suspendedRoute: "/kanban",
    });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));

    expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
    expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });

  test("keeps focus while optimistic selection waits on a suspended target route", () => {
    renderSidebarRoutingScenario({ initialRoute: "/sessions", suspendedRoute: "/kanban" });

    const kanbanLink = screen.getByRole("link", { name: "Kanban" });
    kanbanLink.focus();
    fireEvent.click(kanbanLink);

    expect(screen.getByLabelText("Current route").textContent).toBe("/sessions");
    expect(kanbanLink.isConnected).toBe(true);
    expect(document.activeElement).toBe(kanbanLink);
    expect(kanbanLink.className).toContain("bg-sidebar-accent");
  });

  test("keeps focus when route commit replaces optimistic selection with active selection", async () => {
    renderSidebarRoutingScenario({ initialRoute: "/sessions" });

    const kanbanLink = screen.getByRole("link", { name: "Kanban" });
    kanbanLink.focus();
    fireEvent.click(kanbanLink);

    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/kanban"));

    expect(kanbanLink.isConnected).toBe(true);
    expect(document.activeElement).toBe(kanbanLink);
    expect(kanbanLink.className).toContain("bg-sidebar-accent");
  });

  test("does not revive stale optimistic selection after browser back restores the source entry", async () => {
    renderSidebarRoutingScenario({ initialRoute: "/sessions" });

    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await waitFor(() => expect(screen.getByLabelText("Current route").textContent).toBe("/kanban"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Current route").textContent).toBe("/sessions"),
    );

    expect(screen.getByRole("link", { name: "Kanban" }).className).not.toContain(
      "bg-sidebar-accent",
    );
  });
});
