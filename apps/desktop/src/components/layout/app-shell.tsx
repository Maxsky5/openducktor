import { DiagnosticsPanel } from "@/components/features/diagnostics-panel";
import { OpenRepositoryModal } from "@/components/features/open-repository-modal";
import { RepositorySwitcher } from "@/components/features/repository-switcher";
import { SettingsModal } from "@/components/features/settings-modal";
import {
  AppBrand,
  SidebarNavigation,
  WorkspaceSnapshotCard,
  WorkspaceSummaryCard,
} from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { useTasksState, useWorkspaceState } from "@/state";
import { FolderOpen } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

export function AppShell(): ReactElement {
  const { activeRepo, workspaces } = useWorkspaceState();
  const { tasks, runs } = useTasksState();
  const [isRepositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const isRepositoryModalBlocking = !activeRepo && workspaces.length === 0;

  useEffect(() => {
    if (activeRepo) {
      setRepositoryModalOpen(false);
      return;
    }
    setRepositoryModalOpen(true);
  }, [activeRepo]);

  const handleRepositoryModalOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isRepositoryModalBlocking) {
        return;
      }
      setRepositoryModalOpen(open);
    },
    [isRepositoryModalBlocking],
  );

  return (
    <>
      <div className="min-h-screen">
        <div className="grid min-h-screen w-full grid-cols-1 gap-4 p-4 md:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col self-start rounded-2xl border border-slate-200/70 bg-white/85 p-4 shadow-sm backdrop-blur">
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              <AppBrand />

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Repository
                </p>
                <RepositorySwitcher />
              </div>

              <DiagnosticsPanel />

              <Button
                type="button"
                className="w-full justify-start bg-sky-600 text-white hover:bg-sky-500"
                onClick={() => setRepositoryModalOpen(true)}
              >
                <FolderOpen className="size-4" />
                Open Repository
              </Button>

              <SidebarNavigation hasActiveRepo={Boolean(activeRepo)} />
              <WorkspaceSummaryCard activeRepo={activeRepo} />
              <WorkspaceSnapshotCard taskCount={tasks.length} runCount={runs.length} />
            </div>

            <div className="mt-3 border-t border-slate-200 pt-3">
              <SettingsModal triggerClassName="w-full justify-start" triggerSize="default" />
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col">
            <main className="min-h-0 min-w-0 flex-1">
              <Outlet />
            </main>
          </section>
        </div>
      </div>
      <OpenRepositoryModal
        open={isRepositoryModalOpen}
        canClose={!isRepositoryModalBlocking}
        onOpenChange={handleRepositoryModalOpenChange}
      />
    </>
  );
}
