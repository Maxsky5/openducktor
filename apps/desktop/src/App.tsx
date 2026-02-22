import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { AppStateProvider } from "@/state";
import { useWorkspaceState } from "@/state";
import { type ReactElement, Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

const AgentsPage = lazy(async () => {
  const module = await import("@/pages/agents-page");
  return { default: module.AgentsPage };
});

const KanbanPage = lazy(async () => {
  const module = await import("@/pages/kanban-page");
  return { default: module.KanbanPage };
});

const NotFoundPage = lazy(async () => {
  const module = await import("@/pages/not-found-page");
  return { default: module.NotFoundPage };
});

function RouteFallback(): ReactElement {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
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
    <AppStateProvider>
      <>
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
      </>
    </AppStateProvider>
  );
}
