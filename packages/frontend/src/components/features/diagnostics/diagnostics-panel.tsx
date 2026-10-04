import { ArrowUpRight, RefreshCcw, ShieldCheck } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useChecksState, useWorkspaceState } from "@/state";
import {
  useHostRuntimeStatusContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";
import { useDiagnosticsAutoOpenOwner } from "@/state/providers/diagnostics-auto-open-provider";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

type DiagnosticsPanelProps = {
  triggerClassName?: string;
  triggerVariant?: "summary" | "icon";
};

export function DiagnosticsPanel({
  triggerClassName,
  triggerVariant = "summary",
}: DiagnosticsPanelProps): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
  } = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const checks = useChecksState();
  const autoOpenOwner = useDiagnosticsAutoOpenOwner();
  const [isOpen, setOpen] = useState(false);

  const model = useMemo(
    () =>
      buildDiagnosticsPanelModel({
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeStatus,
        runtimeCheck: checks.runtimeCheck,
        hostMcpBridgeCheck: checks.hostMcpBridgeCheck,
        workspace: activeWorkspace,
        checksRepoPath: checks.checksRepoPath,
        taskStoreCheck: checks.taskStoreCheck,
      }),
    [
      activeWorkspace,
      checks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeStatus,
    ],
  );

  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const { hasHostBlockingFailure, hasWorkspaceBlockingFailure } = model;
  useEffect(() => {
    if (autoOpenOwner.claim({ hasHostBlockingFailure, workspaceId, hasWorkspaceBlockingFailure })) {
      setOpen(true);
    }
  }, [autoOpenOwner, hasHostBlockingFailure, hasWorkspaceBlockingFailure, workspaceId]);

  const iconTriggerLabel = `Open diagnostics: ${model.summaryState.label}`;
  const summaryIcon = model.isSummaryChecking ? (
    <RefreshCcw className={cn("size-3.5 animate-spin", model.summaryState.iconClass)} />
  ) : (
    <ShieldCheck className={cn("size-3.5", model.summaryState.iconClass)} />
  );

  const trigger =
    triggerVariant === "icon" ? (
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={cn("size-8", triggerClassName)}
        onClick={() => setOpen(true)}
        aria-label={iconTriggerLabel}
        title={iconTriggerLabel}
      >
        {model.isSummaryChecking ? (
          <RefreshCcw className={cn("size-4 animate-spin", model.summaryState.iconClass)} />
        ) : (
          <ShieldCheck className={cn("size-4", model.summaryState.iconClass)} />
        )}
      </Button>
    ) : (
      <div className={cn("space-y-1.5", triggerClassName)}>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {summaryIcon}
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
    );

  return (
    <>
      {trigger}
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="gap-0 p-0 sm:max-w-xl" aria-describedby={undefined}>
          <SheetHeader className="border-b border-border px-6 pb-4 pt-5">
            <div className="flex items-center justify-between gap-3 pr-8">
              <SheetTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-selected-accent" />
                Diagnostics
              </SheetTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={checks.isRefreshingChecks}
                onClick={() => void checks.refreshChecks()}
              >
                <RefreshCcw
                  className={cn("size-3.5", checks.isRefreshingChecks && "animate-spin")}
                />
                {checks.isRefreshingChecks ? "Refreshing" : "Refresh"}
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <DiagnosticsPanelSections model={model} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
