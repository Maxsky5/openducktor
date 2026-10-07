import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { type RouteObject, RouterProvider } from "react-router";
import { App } from "./App";
import { LegacySessionsRedirect } from "./pages/sessions/legacy-sessions-redirect";
import { SessionsPage } from "./pages/sessions/sessions-page";

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

test("Sessions is available without a lazy route or page-loading boundary", () => {
  const element = findRouteElement(appRoutes(), "/sessions");
  expect(isValidElement(element)).toBe(true);
  if (!isValidElement(element)) throw new Error("Missing route element for /sessions");
  expect(element.type).toBe(SessionsPage);
});

test("old task workflow and chat routes redirect to the matching Sessions content", () => {
  const routes = appRoutes();
  for (const [path, kind] of [
    ["/workflows", "task"],
    ["/agents", "task"],
    ["/chats", "workspace"],
    ["/workspace-sessions", "workspace"],
  ] as const) {
    const element = findRouteElement(routes, path);
    expect(isValidElement<{ kind: string }>(element)).toBe(true);
    if (!isValidElement<{ kind: string }>(element)) {
      throw new Error(`Missing route element for ${path}`);
    }
    expect(element.type).toBe(LegacySessionsRedirect);
    expect(element.props.kind).toBe(kind);
  }
});
