import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useOrchestrator } from "@/state/orchestrator-context";
import { AlertTriangle, ArrowUpRight, RefreshCcw, ShieldCheck } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

const healthVariant = (healthy: boolean | null): "success" | "warning" | "danger" | "secondary" => {
  if (healthy === null) {
    return "secondary";
  }
  if (healthy) {
    return "success";
  }
  return "danger";
};

export function DiagnosticsPanel(): ReactElement {
  const {
    activeRepo,
    activeWorkspace,
    runtimeCheck,
    beadsCheck,
    refreshChecks,
    isLoadingChecks,
    isSwitchingWorkspace,
  } = useOrchestrator();
  const [isOpen, setOpen] = useState(false);
  const autoOpenedByRepoRef = useRef<Set<string>>(new Set());

  const runtimeHealthy = runtimeCheck ? runtimeCheck.gitOk && runtimeCheck.opencodeOk : null;
  const beadsHealthy = beadsCheck ? beadsCheck.beadsOk : null;
  const runtimeCritical = runtimeHealthy === false;
  const beadsCritical = beadsHealthy === false;
  const worktreeConfigured = activeWorkspace?.hasConfig ?? false;
  const repoName = activeRepo?.split("/").filter(Boolean).at(-1) ?? "No repository";

  const criticalReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!activeRepo) {
      return reasons;
    }
    if (runtimeCritical) {
      reasons.push("Runtime checks failing");
    }
    if (beadsCritical) {
      reasons.push("Beads store unavailable");
    }
    return reasons;
  }, [activeRepo, beadsCritical, runtimeCritical]);

  const setupReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!activeRepo) {
      return reasons;
    }
    if (!worktreeConfigured) {
      reasons.push("Configure worktree path");
    }
    return reasons;
  }, [activeRepo, worktreeConfigured]);

  const summaryState: {
    label: string;
    toneClass: string;
    iconClass: string;
  } = useMemo(() => {
    if (!activeRepo) {
      return {
        label: "No repository selected",
        toneClass: "text-slate-500",
        iconClass: "text-slate-500",
      };
    }
    if (criticalReasons.length > 0) {
      return {
        label: "Critical issue",
        toneClass: "text-rose-700",
        iconClass: "text-rose-600",
      };
    }
    if (setupReasons.length > 0) {
      return {
        label: "Setup needed",
        toneClass: "text-amber-700",
        iconClass: "text-amber-600",
      };
    }
    return {
      label: "Healthy",
      toneClass: "text-emerald-700",
      iconClass: "text-emerald-600",
    };
  }, [activeRepo, criticalReasons.length, setupReasons.length]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    if (criticalReasons.length === 0) {
      return;
    }
    if (autoOpenedByRepoRef.current.has(activeRepo)) {
      return;
    }
    autoOpenedByRepoRef.current.add(activeRepo);
    setOpen(true);
  }, [activeRepo, criticalReasons.length]);

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <ShieldCheck className={cn("size-3.5", summaryState.iconClass)} />
              Diagnostics
            </p>
            <p className={cn("truncate text-xs font-medium", summaryState.toneClass)}>
              {summaryState.label}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8 border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
            onClick={() => setOpen(true)}
            aria-label="Open diagnostics"
            title="Open diagnostics"
          >
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
        {criticalReasons.length > 0 ? (
          <p className="truncate px-0.5 text-[11px] text-rose-700" title={criticalReasons[0]}>
            {criticalReasons[0]}
          </p>
        ) : null}
      </div>

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-sky-600" />
                  Diagnostics
                </SheetTitle>
                <SheetDescription>
                  Setup and runtime diagnostics for{" "}
                  <span className="font-semibold">{repoName}</span>.
                </SheetDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!activeRepo || isLoadingChecks || isSwitchingWorkspace}
                onClick={() => void refreshChecks()}
              >
                <RefreshCcw className={cn("size-3.5", isLoadingChecks ? "animate-spin" : "")} />
                Refresh Checks
              </Button>
            </div>
          </SheetHeader>

          <div className="space-y-3">
            <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Repository
                </p>
                <Badge variant={worktreeConfigured ? "success" : "warning"}>
                  {worktreeConfigured ? "Configured" : "Needs setup"}
                </Badge>
              </div>
              {activeWorkspace ? (
                <>
                  <p className="text-sm font-semibold text-slate-900">{repoName}</p>
                  <p className="break-all text-xs text-slate-500">{activeWorkspace.path}</p>
                </>
              ) : (
                <p className="text-xs text-slate-500">Select a repository to load diagnostics.</p>
              )}
            </section>

            <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Runtime Tools
                </p>
                <Badge variant={healthVariant(runtimeHealthy)}>
                  {runtimeHealthy === null ? "Checking" : runtimeHealthy ? "Available" : "Issue"}
                </Badge>
              </div>
              {runtimeCheck ? (
                <div className="space-y-1 text-xs text-slate-700">
                  <p>git: {runtimeCheck.gitVersion ?? "missing"}</p>
                  <p>opencode: {runtimeCheck.opencodeVersion ?? "missing"}</p>
                  {runtimeCheck.errors.length > 0 ? (
                    <p className="flex items-start gap-1 text-rose-700">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>{runtimeCheck.errors.join(" | ")}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Runtime checks are loading...</p>
              )}
            </section>

            <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Beads Store
                </p>
                <Badge variant={healthVariant(beadsHealthy)}>
                  {beadsHealthy === null ? "Checking" : beadsHealthy ? "Ready" : "Unavailable"}
                </Badge>
              </div>
              {activeRepo ? (
                <div className="space-y-1 text-xs text-slate-700">
                  {beadsCheck?.beadsPath ? (
                    <p className="break-all text-slate-500">{beadsCheck.beadsPath}</p>
                  ) : null}
                  {beadsCheck?.beadsError ? (
                    <p className="flex items-start gap-1 text-rose-700">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>{beadsCheck.beadsError}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select a repository first.</p>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
