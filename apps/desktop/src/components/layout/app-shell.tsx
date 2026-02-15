import { DiagnosticsPanel } from "@/components/features/diagnostics-panel";
import { OpenRepositoryModal } from "@/components/features/open-repository-modal";
import { RepositorySwitcher } from "@/components/features/repository-switcher";
import { SettingsModal } from "@/components/features/settings-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOrchestrator } from "@/state/orchestrator-context";
import { Activity, Bot, Columns3, FolderOpen, Hammer, ScrollText, Sparkles } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/planner", icon: ScrollText, label: "Planner" },
  { to: "/builder", icon: Hammer, label: "Builder" },
];

export function AppShell(): ReactElement {
  const { activeRepo, tasks, runs, workspaces } = useOrchestrator();
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
        <div className="grid min-h-screen w-full grid-cols-1 gap-4 p-4 md:grid-cols-[248px_1fr]">
          <aside className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col self-start rounded-2xl border border-slate-200/70 bg-white/85 p-4 shadow-sm backdrop-blur">
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-2 text-white shadow-md">
                  <Bot className="size-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight">OpenBlueprint</p>
                  <p className="text-xs text-slate-500">Agent Orchestration</p>
                </div>
              </div>

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

              <nav className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isDisabled = item.requiresRepo !== false && !activeRepo;
                  return (
                    <NavLink
                      key={item.to}
                      to={isDisabled ? "/kanban" : item.to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition animate-rise-in",
                          isDisabled ? "cursor-not-allowed opacity-50" : "",
                          isActive
                            ? "bg-gradient-to-r from-slate-900 to-slate-700 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                        )
                      }
                      aria-disabled={isDisabled}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>

              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3 text-sky-500" />
                  <span>Workspace</span>
                </div>
                {activeRepo ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold tracking-tight text-slate-800">
                      {activeRepo.split("/").filter(Boolean).at(-1)}
                    </p>
                    <p className="break-all rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] leading-relaxed text-slate-600">
                      {activeRepo}
                    </p>
                  </div>
                ) : (
                  <p className="font-mono">No repo selected</p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Activity className="size-3 text-emerald-600" />
                  <span>Snapshot</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Tasks: {tasks.length}
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Runs: {runs.length}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-slate-200 pt-3">
              <SettingsModal triggerClassName="w-full justify-start" triggerSize="default" />
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <main className="min-h-0 flex-1">
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
