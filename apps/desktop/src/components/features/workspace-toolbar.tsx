import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrchestrator } from "@/state/orchestrator-context";
import { Loader2, RefreshCcw } from "lucide-react";
import type { ReactElement } from "react";

export function WorkspaceToolbar(): ReactElement {
  const {
    activeRepo,
    activeWorkspace,
    runtimeCheck,
    beadsCheck,
    refreshChecks,
    isLoadingChecks,
    isLoadingTasks,
    isSwitchingWorkspace,
  } = useOrchestrator();
  const runtimeHealthy = runtimeCheck ? runtimeCheck.gitOk && runtimeCheck.opencodeOk : false;
  const beadsHealthy = beadsCheck?.beadsOk ?? false;
  const activeRepoName = activeRepo?.split("/").filter(Boolean).at(-1) ?? "No repository selected";

  return (
    <Card className="overflow-hidden border-slate-200/80 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-sky-50 via-white to-emerald-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-2xl">Mission Control</CardTitle>
              <Badge variant={runtimeHealthy && beadsHealthy ? "success" : "warning"}>
                {runtimeHealthy && beadsHealthy ? "Ready" : "Attention needed"}
              </Badge>
              {isLoadingTasks ? (
                <Badge variant="secondary">
                  <Loader2 className="mr-1 size-3 animate-spin" />
                  Loading tasks
                </Badge>
              ) : null}
              {isLoadingChecks ? (
                <Badge variant="secondary">
                  <Loader2 className="mr-1 size-3 animate-spin" />
                  Loading checks
                </Badge>
              ) : null}
            </div>
            <CardDescription>Repository-level health and orchestration status.</CardDescription>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={!activeRepo || isLoadingChecks || isSwitchingWorkspace}
            onClick={() => void refreshChecks()}
          >
            {isLoadingChecks ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            {isLoadingChecks ? "Refreshing Checks..." : "Refresh Checks"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Repository
              </p>
              <Badge variant={activeWorkspace?.hasConfig ? "success" : "warning"}>
                {activeWorkspace?.hasConfig ? "Worktree configured" : "Missing worktree path"}
              </Badge>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">{activeRepoName}</p>
            {activeWorkspace ? (
              <>
                <p className="mt-1 break-all text-xs text-slate-500">{activeWorkspace.path}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Select a repository to load details.</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Runtime Tools
              </p>
              <Badge variant={runtimeHealthy ? "success" : "danger"}>
                {runtimeHealthy ? "Git + Opencode available" : "Runtime issue"}
              </Badge>
            </div>
            {runtimeCheck ? (
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                <p>git: {runtimeCheck.gitVersion ?? "missing"}</p>
                <p>opencode: {runtimeCheck.opencodeVersion ?? "missing"}</p>
                {runtimeCheck.errors.length > 0 ? (
                  <p className="text-rose-700">{runtimeCheck.errors.join(" | ")}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Runtime checks are loading...</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Beads Store
              </p>
              {isLoadingChecks && !beadsCheck ? (
                <Badge variant="secondary">
                  <Loader2 className="mr-1 size-3 animate-spin" />
                  Initializing
                </Badge>
              ) : (
                <Badge variant={beadsHealthy ? "success" : "danger"}>
                  {beadsHealthy ? "Ready" : "Unavailable"}
                </Badge>
              )}
            </div>
            {activeRepo ? (
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                {beadsCheck?.beadsPath ? (
                  <p className="break-all text-slate-500">{beadsCheck.beadsPath}</p>
                ) : null}
                {beadsCheck?.beadsError ? (
                  <p className="text-rose-700">{beadsCheck.beadsError}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Select a repository first.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
