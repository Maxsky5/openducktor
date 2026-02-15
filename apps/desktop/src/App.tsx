import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { BuilderPage } from "@/pages/builder-page";
import { KanbanPage } from "@/pages/kanban-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PlannerPage } from "@/pages/planner-page";
import { OrchestratorProvider } from "@/state/orchestrator-context";
import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useOrchestrator } from "./state/orchestrator-context";

function RequireRepository(): ReactElement {
  const { activeRepo } = useOrchestrator();
  if (!activeRepo) {
    return <Navigate to="/kanban" replace />;
  }
  return <Outlet />;
}

export function App(): ReactElement {
  return (
    <OrchestratorProvider>
      <>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/kanban" replace />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route element={<RequireRepository />}>
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/builder" element={<BuilderPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster />
      </>
    </OrchestratorProvider>
  );
}
