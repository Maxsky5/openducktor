import { LoaderCircle } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { RuntimeRestartControl } from "@/components/features/runtimes/runtime-restart-control";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { cn } from "@/lib/utils";
import { DiagnosticsCallout, DiagnosticsDetail, DiagnosticsIconTile } from "./diagnostics-card";
import type { DiagnosticsRuntimeEntryModel } from "./diagnostics-panel-model";
import { DiagnosticsStatusPill } from "./diagnostics-status";

function RuntimeAction({ entry }: { entry: DiagnosticsRuntimeEntryModel }): ReactNode {
  const { action } = entry;
  if (action === null) return null;
  switch (action.type) {
    case "restart":
      return (
        <RuntimeRestartControl
          runtimeKind={entry.kind}
          runtimeLabel={entry.label}
          actionLabel={action.label}
          isLifecycleBusy={entry.isLifecycleBusy}
        />
      );
    case "open_settings":
      return (
        <SettingsModal
          triggerLabel="Settings"
          triggerSize="sm"
          deepLink={{ kind: "runtime", runtimeKind: entry.kind }}
        />
      );
  }
}

/** One shared runtime: its identity, executable, state, lifecycle action, and last failure. */
export function DiagnosticsRuntimeRow({
  entry,
}: {
  entry: DiagnosticsRuntimeEntryModel;
}): ReactElement {
  const isDisabled = entry.status.health === "neutral";
  return (
    <li className="space-y-2.5 px-4 py-3" data-testid={`diagnostics-runtime-${entry.kind}`}>
      <div className="flex items-center gap-3">
        <DiagnosticsIconTile muted={isDisabled}>
          <AgentRuntimeIcon runtimeKind={entry.kind} className="size-4.5" />
        </DiagnosticsIconTile>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex min-w-0 items-baseline gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{entry.label}</span>
            {entry.version ? (
              <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                {entry.version}
              </span>
            ) : null}
          </p>
          <p
            className={cn(
              "truncate text-xs text-muted-foreground",
              entry.executablePath !== null && "font-mono text-[11px]",
            )}
            title={entry.executablePath ?? undefined}
          >
            {entry.executablePath ?? "Default executable"}
          </p>
          {entry.effectiveExecutablePath ? (
            <DiagnosticsDetail
              detail={{ label: "In use", value: entry.effectiveExecutablePath, isPath: true }}
            />
          ) : null}
        </div>
        <DiagnosticsStatusPill status={entry.status} />
        <RuntimeAction entry={entry} />
      </div>
      {entry.progress ? (
        <p className="flex items-center gap-1.5 pl-12 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
          {entry.progress}
        </p>
      ) : null}
      {entry.failure ? (
        <div className="pl-12">
          <DiagnosticsCallout tone="danger">
            <p className="break-words">{entry.failure.message}</p>
            <p className="text-destructive-muted">{entry.failure.nextAction}</p>
          </DiagnosticsCallout>
        </div>
      ) : null}
    </li>
  );
}
