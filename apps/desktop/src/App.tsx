import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { AgentsPage } from "@/pages/agents-page";
import { BuilderPage } from "@/pages/builder-page";
import { KanbanPage } from "@/pages/kanban-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PlannerPage } from "@/pages/planner-page";
import { AppStateProvider } from "@/state";
import { useWorkspaceState } from "@/state";
import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

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
            <Route path="/kanban" element={<KanbanPage />} />
            <Route element={<RequireRepository />}>
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/builder" element={<BuilderPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster />
      </>
    </AppStateProvider>
  );
}
