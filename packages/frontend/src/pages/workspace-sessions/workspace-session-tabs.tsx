import type { WorkspaceSession } from "@openducktor/contracts";
import { Archive, Check, Circle, CircleAlert, LoaderCircle } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrowserTabs } from "@/components/ui/browser-tabs";
import { RunningStatusDot } from "@/components/ui/running-status-dot";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { cn } from "@/lib/utils";
import {
  useAgentActivitySnapshot,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";

export function WorkspaceSessionTabs({
  sessions,
  selectedId,
  archivingId,
  pending,
  onReorder,
  onArchive,
}: {
  sessions: WorkspaceSession[];
  selectedId: string | null;
  archivingId: string | null;
  pending: boolean;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
  onArchive: (record: WorkspaceSession) => void;
}): ReactElement {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useEffect(() => {
    if (confirmingId === null) return;
    const timeout = window.setTimeout(() => setConfirmingId(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [confirmingId]);
  const handleArchive = (record: WorkspaceSession) => {
    if (record.executionTarget.kind === "local_worktree") {
      setConfirmingId(null);
      onArchive(record);
      return;
    }
    if (confirmingId !== record.id) {
      setConfirmingId(record.id);
      return;
    }
    setConfirmingId(null);
    onArchive(record);
  };
  return (
    <BrowserTabs
      aria-label="Workspace session tabs"
      onReorder={onReorder}
      items={sessions.map((record) => ({
        value: record.id,
        content: <WorkspaceSessionTabContent record={record} />,
        triggerProps: { title: workspaceSessionTitle(record) },
        attributes: { "data-workspace-session-tab-id": record.id },
        action: (
          <WorkspaceSessionTabArchiveAction
            record={record}
            selected={record.id === selectedId}
            pending={pending}
            confirming={confirmingId === record.id}
            archiving={archivingId === record.id}
            onArchive={handleArchive}
          />
        ),
      }))}
    />
  );
}

const archiveButtonLabel = (title: string, confirming: boolean, archiving: boolean): string => {
  if (archiving) return `Archiving ${title}`;
  if (confirming) return `Confirm stop and archive ${title}`;
  return `Archive ${title}`;
};

const iconSwapClassName = (visible: boolean): string =>
  cn(
    "col-start-1 row-start-1 transition-[opacity,filter,transform] duration-[250ms] ease-in-out will-change-[opacity,filter,transform] motion-reduce:transition-none",
    visible ? "scale-100 opacity-100 blur-[0px]" : "scale-25 opacity-0 blur-[2px]",
  );

function WorkspaceSessionTabContent({ record }: { record: WorkspaceSession }): ReactElement {
  const { repositorySessions } = useAgentActivitySnapshot();
  const identity = workspaceSessionIdentity(record);
  const identityKey = identity ? agentSessionIdentityKey(identity) : null;
  const session = repositorySessions.find(
    (entry) => agentSessionIdentityKey(entry) === identityKey,
  );
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const statusAvailable = sessionReadModelLoadState.kind === "ready";
  const activity = session && statusAvailable ? session.activityState : null;
  const statusLabel = statusAvailable ? (activity ?? "idle") : "Status unavailable";
  let statusIcon: ReactElement;
  if (isAgentSessionActivityWorking(activity)) {
    statusIcon = <RunningStatusDot />;
  } else if (activity === "waiting_input") {
    statusIcon = <CircleAlert className="size-3.5 text-warning-accent" />;
  } else if (activity === "error") {
    statusIcon = <CircleAlert className="size-3.5 text-destructive" />;
  } else {
    statusIcon = <Circle className="size-3.5 fill-input text-input" />;
  }
  const title = workspaceSessionTitle(record);
  return (
    <>
      <span
        aria-label={statusLabel}
        className="inline-flex size-5 shrink-0 items-center justify-center"
      >
        {statusIcon}
      </span>
      <span className="max-w-48 truncate">{title}</span>
    </>
  );
}

function WorkspaceSessionTabArchiveAction({
  record,
  selected,
  pending,
  confirming,
  archiving,
  onArchive,
}: {
  record: WorkspaceSession;
  selected: boolean;
  pending: boolean;
  confirming: boolean;
  archiving: boolean;
  onArchive: (record: WorkspaceSession) => void;
}): ReactElement {
  const archiveLabel = archiveButtonLabel(workspaceSessionTitle(record), confirming, archiving);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative mr-1 size-6 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[active=true]:opacity-100",
        confirming && "text-foreground opacity-100",
        archiving && "text-foreground disabled:opacity-100",
      )}
      data-active={selected}
      aria-label={archiveLabel}
      aria-busy={archiving}
      title={archiveLabel}
      disabled={pending}
      onClick={() => onArchive(record)}
    >
      <span className="grid">
        <span className={cn("inline-flex", iconSwapClassName(!confirming && !archiving))}>
          <Archive aria-hidden="true" />
        </span>
        <span className={cn("inline-flex", iconSwapClassName(confirming && !archiving))}>
          <Check aria-hidden="true" />
        </span>
        <span className={cn("inline-flex", iconSwapClassName(archiving))}>
          <span className="inline-flex motion-safe:animate-spin">
            <LoaderCircle aria-hidden="true" />
          </span>
        </span>
      </span>
    </Button>
  );
}
