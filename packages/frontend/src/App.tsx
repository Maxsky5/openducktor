import { lazy, type ReactElement, Suspense } from "react";
import {
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { ApplicationOverlays } from "@/components/layout/application-overlays";
import { ThemeProvider } from "@/components/layout/theme-provider";
import {
  WorkspacePreviewRouteGuard,
  WorkspacePreviewTransitionGuardProvider,
} from "@/components/layout/workspace-preview-transition-guard";
import { Toaster } from "@/components/ui/sonner";
import { CanonicalRouteRedirect } from "@/lib/canonical-route-redirect";
import { QueryProvider } from "@/lib/query-provider";
import { loadNotFoundPage } from "@/pages";
import { AgentsPage } from "@/pages/agents/agents-page";
import { KanbanPage } from "@/pages/kanban/kanban-page";
import WorkspaceSessionsPage from "@/pages/workspace-sessions/workspace-sessions-page";
import { AppStateProvider } from "@/state";
import { KanbanBoardLoadingShell } from "./pages/kanban/kanban-board-loading-shell";

const NotFoundPage = lazy(loadNotFoundPage);

export type AppRouterMode = "browser" | "hash";

type AppProps = {
  routerMode?: AppRouterMode;
};

function RouteFallback(): ReactElement {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading page…
    </div>
  );
}

function KanbanRouteFallback(): ReactElement {
  return (
    <div className="flex h-full min-h-full min-w-0 flex-col gap-4 py-4 pl-4">
      <div className="flex items-center justify-between pr-4">
        <div className="space-y-2">
          <div className="h-6 w-32 rounded-full bg-muted" />
          <div className="h-4 w-24 rounded-full bg-muted" />
        </div>
      </div>
      <section className="relative min-h-0 min-w-0 flex-1" aria-busy="true">
        <KanbanBoardLoadingShell label="Loading tasks…" testId="kanban-route-loading-overlay" />
      </section>
    </div>
  );
}

function withRouteFallback(element: ReactElement, fallback?: ReactElement): ReactElement {
  return <Suspense fallback={fallback ?? <RouteFallback />}>{element}</Suspense>;
}

function AppProviders(): ReactElement {
  return (
    <QueryProvider>
      <ThemeProvider>
        <AppStateProvider>
          <WorkspacePreviewTransitionGuardProvider>
            <ApplicationOverlays>
              <WorkspacePreviewRouteGuard />
              <Outlet />
              <Toaster />
            </ApplicationOverlays>
          </WorkspacePreviewTransitionGuardProvider>
        </AppStateProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

const routes = createRoutesFromElements(
  <Route element={<AppProviders />}>
    <Route element={<AppShell />}>
      <Route path="/" element={<Navigate to="/kanban" replace />} />
      <Route path="/onboarding" element={<Navigate to="/kanban" replace />} />
      <Route path="/kanban" element={withRouteFallback(<KanbanPage />, <KanbanRouteFallback />)} />
      <Route path="/workflows" element={<AgentsPage />} />
      <Route path="/chats" element={<WorkspaceSessionsPage />} />
      <Route path="/agents" element={<CanonicalRouteRedirect to="/workflows" />} />
      <Route path="/workspace-sessions" element={<CanonicalRouteRedirect to="/chats" />} />
      <Route path="/planner" element={<Navigate to="/workflows?agent=planner" replace />} />
      <Route path="/builder" element={<Navigate to="/workflows?agent=build" replace />} />
      <Route path="*" element={withRouteFallback(<NotFoundPage />)} />
    </Route>
  </Route>,
);

const routers: Partial<Record<AppRouterMode, ReturnType<typeof createBrowserRouter>>> = {};

function routerForMode(mode: AppRouterMode): ReturnType<typeof createBrowserRouter> {
  if (mode === "browser") return (routers.browser ??= createBrowserRouter(routes));
  return (routers.hash ??= createHashRouter(routes));
}

export function App({ routerMode = "browser" }: AppProps): ReactElement {
  return <RouterProvider router={routerForMode(routerMode)} useTransitions={false} />;
}
