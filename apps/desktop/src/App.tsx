import { AppShell } from "@/components/layout/app-shell";
import { BuilderPage } from "@/pages/builder-page";
import { KanbanPage } from "@/pages/kanban-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { OpenRepositoryPage } from "@/pages/open-repository-page";
import { PlannerPage } from "@/pages/planner-page";
import { OrchestratorProvider } from "@/state/orchestrator-context";
import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useOrchestrator } from "./state/orchestrator-context";

function HomeRoute(): ReactElement {
  const { activeRepo } = useOrchestrator();
  return <Navigate to={activeRepo ? "/kanban" : "/open-repository"} replace />;
}

function RequireRepository(): ReactElement {
  const { activeRepo } = useOrchestrator();
  if (!activeRepo) {
    return <Navigate to="/open-repository" replace />;
  }
  return <Outlet />;
}

export function App(): ReactElement {
  return (
    <OrchestratorProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/open-repository" element={<OpenRepositoryPage />} />
          <Route element={<RequireRepository />}>
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/builder" element={<BuilderPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </OrchestratorProvider>
  );
}
