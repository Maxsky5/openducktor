import { lazy, type ReactElement, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-provider";
import { loadAgentsPage, loadKanbanPage, loadNotFoundPage } from "@/pages";
import { AppStateProvider } from "@/state";

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

export function App(): ReactElement {
  return (
    <QueryProvider>
      <ThemeProvider>
        <AppStateProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/kanban" replace />} />
              <Route path="/kanban" element={withRouteFallback(<KanbanPage />)} />
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
