import { ArrowUpRight, RefreshCcw, ShieldCheck } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useChecksState, useWorkspaceState } from "@/state";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

export function DiagnosticsPanel(): ReactElement {
  const { activeRepo, activeWorkspace, isSwitchingWorkspace } = useWorkspaceState();
  const { runtimeCheck, beadsCheck, opencodeHealth, refreshChecks, isLoadingChecks } =
    useChecksState();
  const [isOpen, setOpen] = useState(false);
  const autoOpenedByRepoRef = useRef<Set<string>>(new Set());

  const model = useMemo(
    () =>
      buildDiagnosticsPanelModel({
        activeRepo,
        activeWorkspace,
        runtimeCheck,
        beadsCheck,
        opencodeHealth,
        isLoadingChecks,
      }),
    [activeRepo, activeWorkspace, runtimeCheck, beadsCheck, opencodeHealth, isLoadingChecks],
  );

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    if (model.criticalReasons.length === 0) {
      return;
    }
    if (autoOpenedByRepoRef.current.has(activeRepo)) {
      return;
    }
    autoOpenedByRepoRef.current.add(activeRepo);
    setOpen(true);
  }, [activeRepo, model.criticalReasons.length]);

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {model.isSummaryChecking ? (
                <RefreshCcw className={cn("size-3.5 animate-spin", model.summaryState.iconClass)} />
              ) : (
                <ShieldCheck className={cn("size-3.5", model.summaryState.iconClass)} />
              )}
              Diagnostics
            </p>
            <p className={cn("truncate text-xs font-medium", model.summaryState.toneClass)}>
              {model.summaryState.label}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8 border-input bg-card text-foreground shadow-sm hover:border-input hover:bg-muted"
            onClick={() => setOpen(true)}
            aria-label="Open diagnostics"
            title="Open diagnostics"
          >
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
        {model.criticalReasons.length > 0 ? (
          <p
            className="truncate px-0.5 text-[11px] text-destructive-muted"
            title={model.criticalReasons[0]}
          >
            {model.criticalReasons[0]}
          </p>
        ) : null}
      </div>

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" />
                  Diagnostics
                </SheetTitle>
                <SheetDescription>
                  Setup and runtime diagnostics for{" "}
                  <span className="font-semibold">{model.repoName}</span>.
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

          <DiagnosticsPanelSections model={model} />
        </SheetContent>
      </Sheet>
    </>
  );
}
