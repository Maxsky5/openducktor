import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { type RouteObject, RouterProvider } from "react-router";
import { App } from "./App";
import { CanonicalRouteRedirect } from "./lib/canonical-route-redirect";
import { AgentsPage } from "./pages/agents/agents-page";
import WorkspaceSessionsPage from "./pages/workspace-sessions/workspace-sessions-page";

function findRouteElement(routes: RouteObject[], path: string): ReactNode {
  for (const route of routes) {
    if (route.path === path) return route.element;
    const match = findRouteElement(route.children ?? [], path);
    if (match) return match;
  }
  return null;
}

function appRoutes(): RouteObject[] {
  const app = App({});
  if (!isValidElement<{ router: { routes: RouteObject[] } }>(app) || app.type !== RouterProvider) {
    throw new Error("App must provide its router");
  }
  return app.props.router.routes;
}

test("Chats and Task workflows are available without a lazy route or page-loading boundary", () => {
  const routes = appRoutes();
  for (const [path, page] of [
    ["/workflows", AgentsPage],
    ["/chats", WorkspaceSessionsPage],
  ] as const) {
    const element = findRouteElement(routes, path);
    expect(isValidElement(element)).toBe(true);
    if (!isValidElement(element)) throw new Error(`Missing route element for ${path}`);
    expect(element.type).toBe(page);
  }
});

test("old session page routes redirect to their canonical routes", () => {
  const routes = appRoutes();
  for (const [path, destination] of [
    ["/agents", "/workflows"],
    ["/workspace-sessions", "/chats"],
  ] as const) {
    const element = findRouteElement(routes, path);
    expect(isValidElement<{ to: string }>(element)).toBe(true);
    if (!isValidElement<{ to: string }>(element)) {
      throw new Error(`Missing route element for ${path}`);
    }
    expect(element.type).toBe(CanonicalRouteRedirect);
    expect(element.props.to).toBe(destination);
  }
});
