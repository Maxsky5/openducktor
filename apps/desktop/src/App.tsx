import { lazy, type ReactElement, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { loadAgentsPage, loadKanbanPage, loadNotFoundPage } from "@/pages";
import { AppStateProvider, useWorkspaceState } from "@/state";

const AgentsPage = lazy(loadAgentsPage);

const KanbanPage = lazy(loadKanbanPage);

const NotFoundPage = lazy(loadNotFoundPage);

function RouteFallback(): ReactElement {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading page...
    </div>
  );
}

function withRouteFallback(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

function RequireRepository(): ReactElement {
  const { activeRepo } = useWorkspaceState();
  if (!activeRepo) {
    return <Navigate to="/kanban" replace />;
  }
  return <Outlet />;
}

export function App(): ReactElement {
  return (
    <ThemeProvider defaultTheme="system" storageKey="openducktor-ui-theme">
      <AppStateProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/kanban" replace />} />
            <Route path="/kanban" element={withRouteFallback(<KanbanPage />)} />
            <Route element={<RequireRepository />}>
              <Route path="/agents" element={withRouteFallback(<AgentsPage />)} />
              <Route path="/planner" element={<Navigate to="/agents?agent=planner" replace />} />
              <Route path="/builder" element={<Navigate to="/agents?agent=build" replace />} />
            </Route>
            <Route path="*" element={withRouteFallback(<NotFoundPage />)} />
          </Route>
        </Routes>
        <Toaster />
      </AppStateProvider>
    </ThemeProvider>
  );
}

