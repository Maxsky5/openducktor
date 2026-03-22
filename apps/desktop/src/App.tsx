import { lazy, type ReactElement, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-provider";
import { loadAgentsPage, loadKanbanPage, loadNotFoundPage } from "@/pages";
import { AppStateProvider } from "@/state";
import { KanbanBoardLoadingShell } from "./pages/kanban/kanban-board-loading-shell";

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
        <KanbanBoardLoadingShell label="Loading tasks..." testId="kanban-route-loading-overlay" />
      </section>
    </div>
  );
}

function withRouteFallback(element: ReactElement, fallback?: ReactElement): ReactElement {
  return <Suspense fallback={fallback ?? <RouteFallback />}>{element}</Suspense>;
}

export function App(): ReactElement {
  return (
    <QueryProvider>
      <ThemeProvider>
        <AppStateProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/kanban" replace />} />
              <Route
                path="/kanban"
                element={withRouteFallback(<KanbanPage />, <KanbanRouteFallback />)}
              />
              <Route path="/agents" element={withRouteFallback(<AgentsPage />)} />
              <Route path="/planner" element={<Navigate to="/agents?agent=planner" replace />} />
              <Route path="/builder" element={<Navigate to="/agents?agent=build" replace />} />
              <Route path="*" element={withRouteFallback(<NotFoundPage />)} />
            </Route>
          </Routes>
          <Toaster />
        </AppStateProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
