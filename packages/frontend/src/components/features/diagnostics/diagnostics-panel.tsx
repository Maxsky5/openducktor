import { RefreshCcw, ShieldCheck } from "lucide-react";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { useChecksState, useWorkspaceState } from "@/state";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useHostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useDiagnosticsAutoOpenOwner } from "@/state/providers/diagnostics-auto-open-provider";
import {
  buildDiagnosticsPanelModel,
  type DiagnosticsPanelModel,
} from "@openducktor/frontend-core/diagnostics/diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";
import { DIAGNOSTICS_SUMMARY_ICON_CLASSES } from "./diagnostics-summary-styles";

type DiagnosticsPanelContextValue = {
  model: DiagnosticsPanelModel;
  openDiagnostics: () => void;
};

const DiagnosticsPanelContext = createContext<DiagnosticsPanelContextValue | null>(null);

export function useDiagnosticsPanel(): DiagnosticsPanelContextValue {
  const value = use(DiagnosticsPanelContext);
  if (!value) throw new Error("useDiagnosticsPanel must be used inside DiagnosticsPanelProvider.");
  return value;
}

const noSubscription = (): (() => void) => () => {};

/** A remote host connection is live only while it is connected. A local host is always live. */
function useHostConnectionLive(): boolean {
  const connection = getShellBridge().remoteConnection;
  return useSyncExternalStore(
    connection?.subscribeState ?? noSubscription,
    () => connection === undefined || connection.readState().status === "connected",
    () => true,
  );
}

/** Owns the one diagnostics sheet and its automatic opening. Triggers and commands open it. */
export function DiagnosticsPanelProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useWorkspaceState();
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
  } = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const checks = useChecksState();
  const connectionLive = useHostConnectionLive();
  const autoOpenOwner = useDiagnosticsAutoOpenOwner();
  const [isOpen, setOpen] = useState(false);

  const model = useMemo(
    () =>
      buildDiagnosticsPanelModel({
        connectionLive,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeStatus,
        pathCheck: checks.pathCheck,
        gitCheck: checks.gitCheck,
        workspace: activeWorkspace,
        checksRepoPath: checks.checksRepoPath,
        taskStoreCheck: checks.taskStoreCheck,
      }),
    [
      activeWorkspace,
      checks,
      connectionLive,
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

  const openDiagnostics = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ model, openDiagnostics }), [model, openDiagnostics]);

  return (
    <DiagnosticsPanelContext value={value}>
      {children}
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
                disabled={checks.isRefreshingChecks || !connectionLive}
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
    </DiagnosticsPanelContext>
  );
}

/** Opens the diagnostics sheet. Its icon shows the state of the checks. */
export function DiagnosticsTrigger({ className }: { className?: string }): ReactElement {
  const { model, openDiagnostics } = useDiagnosticsPanel();
  const label = `Open diagnostics: ${model.summaryState.label}`;
  const iconClass = DIAGNOSTICS_SUMMARY_ICON_CLASSES[model.summaryState.tone];
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={cn("size-8", className)}
      onClick={openDiagnostics}
      aria-label={label}
      title={label}
    >
      {model.isSummaryChecking ? (
        <RefreshCcw className={cn("size-4 animate-spin", iconClass)} />
      ) : (
        <ShieldCheck className={cn("size-4", iconClass)} />
      )}
    </Button>
  );
}
