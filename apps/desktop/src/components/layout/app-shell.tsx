import { FolderOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Outlet } from "react-router-dom";
import { DiagnosticsPanel } from "@/components/features/diagnostics";
import { OpenRepositoryModal } from "@/components/features/open-repository-modal";
import { RepositorySwitcher } from "@/components/features/repository-switcher";
import {
  AgentActivityCard,
  AppBrand,
  BranchSwitcher,
  SidebarNavigation,
  WorkspaceSummaryCard,
} from "@/components/layout/sidebar";
import { summarizeAgentActivity } from "@/components/layout/sidebar/agent-activity-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentState, useWorkspaceState } from "@/state";

const SettingsModal = lazy(async () => {
  const module = await import("@/components/features/settings-modal");
  return { default: module.SettingsModal };
});

export function AppShell(): ReactElement {
  const { activeRepo, workspaces } = useWorkspaceState();
  const { sessions } = useAgentState();
  const [isRepositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const isRepositoryModalBlocking = !activeRepo && workspaces.length === 0;
  const agentActivity = useMemo(() => summarizeAgentActivity(sessions), [sessions]);

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
      <div className="h-screen min-h-screen w-full overflow-hidden">
        <div className="flex h-full min-h-0 w-full">
          <aside
            className={cn(
              "flex h-full min-w-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-out",
              isSidebarOpen ? "w-[248px]" : "w-14",
            )}
          >
            {isSidebarOpen ? (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  <div className="flex items-start justify-between gap-2">
                    <AppBrand />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="mt-0.5 h-8 w-8 shrink-0 text-slate-500 hover:text-slate-900"
                      onClick={() => setSidebarOpen(false)}
                      aria-label="Hide sidebar"
                      title="Hide sidebar"
                    >
                      <PanelLeftClose className="size-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Repository
                    </p>
                    <div className="flex items-center gap-2">
                      <RepositorySwitcher className="min-w-0 flex-1" />
                      <Button
                        type="button"
                        size="icon"
                        className="shrink-0 bg-sky-600 text-white hover:bg-sky-500"
                        onClick={() => setRepositoryModalOpen(true)}
                        aria-label="Open repository"
                        title="Open repository"
                      >
                        <FolderOpen className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <BranchSwitcher />

                  <DiagnosticsPanel />

                  <SidebarNavigation hasActiveRepo={Boolean(activeRepo)} />
                  <AgentActivityCard
                    activeSessionCount={agentActivity.activeSessionCount}
                    waitingForInputCount={agentActivity.waitingForInputCount}
                  />
                  <WorkspaceSummaryCard />
                </div>

                <div className="border-t border-slate-200 p-3">
                  <Suspense
                    fallback={
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start"
                        disabled
                      >
                        Settings
                      </Button>
                    }
                  >
                    <SettingsModal triggerClassName="w-full justify-start" triggerSize="default" />
                  </Suspense>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center gap-2 p-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-500 hover:text-slate-900"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Show sidebar"
                  title="Show sidebar"
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 bg-sky-600 text-white hover:bg-sky-500"
                  onClick={() => setRepositoryModalOpen(true)}
                  aria-label="Open repository"
                  title="Open repository"
                >
                  <FolderOpen className="size-4" />
                </Button>
                <div className="w-full border-t border-slate-200 pt-2">
                  <SidebarNavigation hasActiveRepo={Boolean(activeRepo)} compact />
                </div>
              </div>
            )}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            <main
              data-main-scroll-container="true"
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            >
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
