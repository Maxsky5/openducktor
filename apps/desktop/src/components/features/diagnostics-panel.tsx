import {
  DiagnosticsSection,
  buildDiagnosticsSummary,
  healthVariant,
} from "@/components/features/diagnostics";
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
import { useChecksState, useWorkspaceState } from "@/state";
import { AlertTriangle, ArrowUpRight, RefreshCcw, ShieldCheck } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

type DiagnosticKeyValueRowProps = {
  label: string;
  value: string;
  mono?: boolean;
  breakAll?: boolean;
  valueClassName?: string;
};

function DiagnosticKeyValueRow({
  label,
  value,
  mono = false,
  breakAll = false,
  valueClassName,
}: DiagnosticKeyValueRowProps): ReactElement {
  return (
    <p className="text-xs text-slate-700">
      <span className="font-medium text-slate-600">{label}:</span>{" "}
      <span
        className={cn(
          mono ? "font-mono text-[11px]" : "",
          breakAll ? "break-all" : "",
          valueClassName,
        )}
      >
        {value}
      </span>
    </p>
  );
}

export function DiagnosticsPanel(): ReactElement {
  const { activeRepo, activeWorkspace, isSwitchingWorkspace } = useWorkspaceState();
  const { runtimeCheck, beadsCheck, opencodeHealth, refreshChecks, isLoadingChecks } =
    useChecksState();
  const [isOpen, setOpen] = useState(false);
  const autoOpenedByRepoRef = useRef<Set<string>>(new Set());

  const runtimeHealthy = runtimeCheck ? runtimeCheck.gitOk && runtimeCheck.opencodeOk : null;
  const beadsHealthy = beadsCheck ? beadsCheck.beadsOk : null;
  const opencodeServerHealthy = opencodeHealth ? opencodeHealth.runtimeOk : null;
  const openducktorMcpHealthy = opencodeHealth ? opencodeHealth.mcpOk : null;
  const runtimeCritical = runtimeHealthy === false;
  const beadsCritical = beadsHealthy === false;
  const opencodeServerCritical = opencodeServerHealthy === false;
  const openducktorMcpCritical = openducktorMcpHealthy === false;
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
    if (opencodeServerCritical) {
      reasons.push("OpenCode server unavailable");
    }
    if (openducktorMcpCritical) {
      reasons.push("OpenDucktor MCP unavailable");
    }
    if (beadsCritical) {
      reasons.push("Beads store unavailable");
    }
    return reasons;
  }, [activeRepo, beadsCritical, opencodeServerCritical, openducktorMcpCritical, runtimeCritical]);

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

  const isSummaryChecking =
    Boolean(activeRepo) &&
    (isLoadingChecks || runtimeCheck === null || beadsCheck === null || opencodeHealth === null);

  const summaryState = useMemo(
    () =>
      buildDiagnosticsSummary({
        hasActiveRepo: Boolean(activeRepo),
        isChecking: isSummaryChecking,
        hasCriticalIssues: criticalReasons.length > 0,
        hasSetupIssues: setupReasons.length > 0,
      }),
    [activeRepo, criticalReasons.length, isSummaryChecking, setupReasons.length],
  );

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
              {isSummaryChecking ? (
                <RefreshCcw className={cn("size-3.5 animate-spin", summaryState.iconClass)} />
              ) : (
                <ShieldCheck className={cn("size-3.5", summaryState.iconClass)} />
              )}
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
            <DiagnosticsSection
              title="Repository"
              badge={{
                label: worktreeConfigured ? "Configured" : "Needs setup",
                variant: worktreeConfigured ? "success" : "warning",
              }}
            >
              {activeWorkspace ? (
                <div className="space-y-1">
                  <DiagnosticKeyValueRow label="Repository" value={repoName} />
                  <DiagnosticKeyValueRow
                    label="Repository path"
                    value={activeWorkspace.path}
                    breakAll
                    valueClassName="text-slate-500"
                  />
                  <DiagnosticKeyValueRow
                    label="Worktree directory"
                    value={activeWorkspace.configuredWorktreeBasePath ?? "Not configured"}
                    breakAll
                    valueClassName={
                      activeWorkspace.configuredWorktreeBasePath
                        ? "text-slate-500"
                        : "text-slate-400"
                    }
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select a repository to load diagnostics.</p>
              )}
            </DiagnosticsSection>

            <DiagnosticsSection
              title="CLI Tools"
              badge={{
                label:
                  runtimeHealthy === null ? "Checking" : runtimeHealthy ? "Available" : "Issue",
                variant: healthVariant(runtimeHealthy),
              }}
            >
              {runtimeCheck ? (
                <div className="space-y-1 text-xs text-slate-700">
                  <DiagnosticKeyValueRow label="Git" value={runtimeCheck.gitVersion ?? "missing"} />
                  <DiagnosticKeyValueRow
                    label="OpenCode"
                    value={
                      runtimeCheck.opencodeOk
                        ? (runtimeCheck.opencodeVersion ?? "detected")
                        : "missing"
                    }
                  />
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
            </DiagnosticsSection>

            <DiagnosticsSection
              title="OpenCode Runtime"
              badge={{
                label:
                  opencodeServerHealthy === null
                    ? "Checking"
                    : opencodeServerHealthy
                      ? "Running"
                      : "Unavailable",
                variant: healthVariant(opencodeServerHealthy),
              }}
            >
              {activeRepo ? (
                <div className="space-y-1 text-xs text-slate-700">
                  {opencodeHealth?.runtime ? (
                    <>
                      <DiagnosticKeyValueRow
                        label="Runtime ID"
                        value={opencodeHealth.runtime.runtimeId}
                        mono
                        valueClassName="text-slate-600"
                      />
                      <DiagnosticKeyValueRow
                        label="Endpoint"
                        value={`http://127.0.0.1:${opencodeHealth.runtime.port}`}
                        mono
                        valueClassName="text-slate-600"
                      />
                      <DiagnosticKeyValueRow
                        label="Working directory"
                        value={opencodeHealth.runtime.workingDirectory}
                        breakAll
                        valueClassName="text-slate-500"
                      />
                    </>
                  ) : null}
                  {opencodeHealth?.runtimeError ? (
                    <p className="flex items-start gap-1 text-rose-700">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>{opencodeHealth.runtimeError}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select a repository first.</p>
              )}
            </DiagnosticsSection>

            <DiagnosticsSection
              title="OpenDucktor MCP"
              badge={{
                label:
                  openducktorMcpHealthy === null
                    ? "Checking"
                    : openducktorMcpHealthy
                      ? "Connected"
                      : "Unavailable",
                variant: healthVariant(openducktorMcpHealthy),
              }}
            >
              {activeRepo ? (
                <div className="space-y-1 text-xs text-slate-700">
                  <DiagnosticKeyValueRow
                    label="Server name"
                    value={opencodeHealth?.mcpServerName ?? "openducktor"}
                    mono
                  />
                  <DiagnosticKeyValueRow
                    label="Status"
                    value={opencodeHealth?.mcpServerStatus ?? "unavailable"}
                    valueClassName={
                      opencodeHealth?.mcpServerStatus ? "font-medium" : "text-slate-500"
                    }
                  />
                  {opencodeHealth ? (
                    <DiagnosticKeyValueRow
                      label="Tools detected"
                      value={String(opencodeHealth.availableToolIds.length)}
                      mono
                      valueClassName="text-slate-600"
                    />
                  ) : null}
                  {opencodeHealth?.mcpServerError || opencodeHealth?.mcpError ? (
                    <p className="flex items-start gap-1 text-rose-700">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>{opencodeHealth.mcpServerError ?? opencodeHealth.mcpError}</span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select a repository first.</p>
              )}
            </DiagnosticsSection>

            <DiagnosticsSection
              title="Beads Store"
              badge={{
                label: beadsHealthy === null ? "Checking" : beadsHealthy ? "Ready" : "Unavailable",
                variant: healthVariant(beadsHealthy),
              }}
            >
              {activeRepo ? (
                <div className="space-y-1 text-xs text-slate-700">
                  {beadsCheck?.beadsPath ? (
                    <DiagnosticKeyValueRow
                      label="Store path"
                      value={beadsCheck.beadsPath}
                      breakAll
                      valueClassName="text-slate-500"
                    />
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
            </DiagnosticsSection>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
