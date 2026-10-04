import type {
  AgentSessionActivity,
  RuntimeKind,
  RuntimeLifecycleImpact,
  RuntimeLifecycleSessionImpact,
} from "@openducktor/contracts";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { hasLiveSessions } from "./runtime-impact-review";

/** An executable path change that a settings save applies to one runtime kind. */
export type RuntimeImpactPathChange = {
  kind: RuntimeKind;
  label: string;
  oldExecutablePath: string | null;
  newExecutablePath: string | null;
};

type RuntimeImpactDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  /** For example `Restart` or `Save and apply`. */
  confirmLabel: string;
  /** The reviewed impact. Null while the first read is in progress or after it failed. */
  impact: RuntimeLifecycleImpact | null;
  isLoadingImpact: boolean;
  /** A failed impact read. It prevents confirmation. */
  impactError: string | null;
  /** Shown above the sessions, for example when the impact changed and needs a new review. */
  notice?: string | null;
  pathChanges?: RuntimeImpactPathChange[];
  isPending: boolean;
  /** A failed lifecycle action. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export const IMPACT_EXPLANATION =
  "This action stops the live sessions listed below and rejects their pending input. Saved sessions stay available from history.";
export const NO_IMPACT_MESSAGE = "No live sessions are affected.";

/**
 * Shared confirmation for runtime lifecycle actions that stop live sessions: manual restart and
 * runtime settings application. `Cancel` changes nothing.
 */
export function RuntimeImpactDialog({
  open,
  title,
  description,
  confirmLabel,
  impact,
  isLoadingImpact,
  impactError,
  notice = null,
  pathChanges = [],
  isPending,
  error,
  onConfirm,
  onCancel,
}: RuntimeImpactDialogProps): ReactElement {
  const canConfirm = impact !== null && impactError === null && !isLoadingImpact && !isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPending) onCancel();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody className="mt-4 min-h-0 space-y-4 overflow-y-auto">
          {pathChanges.length > 0 ? <PathChanges pathChanges={pathChanges} /> : null}
          {notice ? (
            <p className="rounded-md border border-warning-border bg-warning-surface p-2 text-sm text-warning-muted">
              {notice}
            </p>
          ) : null}
          {isLoadingImpact ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              {impact === null ? "Loading affected sessions." : "Updating affected sessions."}
            </p>
          ) : null}
          {impactError !== null ? (
            <ErrorText message={`Affected sessions could not be read: ${impactError}`} />
          ) : null}
          {impactError === null && impact !== null ? <ImpactSessions impact={impact} /> : null}
          {error !== null ? <ErrorText message={error} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={!canConfirm} onClick={onConfirm}>
            {isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActivityBadge = { label: string; variant: "warning" | "secondary" | "danger" };

const ACTIVITY_BADGES = {
  running: { label: "Running", variant: "warning" },
  retrying: { label: "Retrying", variant: "warning" },
  waiting_for_question: { label: "Waiting for input", variant: "danger" },
  waiting_for_permission: { label: "Waiting for approval", variant: "danger" },
  idle: { label: "Idle", variant: "secondary" },
} satisfies Record<AgentSessionActivity, ActivityBadge>;

function SessionRow({ session }: { session: RuntimeLifecycleSessionImpact }): ReactElement {
  const activity = ACTIVITY_BADGES[session.activity];
  const isChild = session.parentExternalSessionId !== undefined;
  return (
    <li
      className={cn("space-y-1 rounded-md border border-border bg-card p-2", isChild && "ml-4")}
      data-testid="runtime-impact-session"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-foreground">
          {isChild ? <span className="text-muted-foreground">Child session: </span> : null}
          {session.title}
        </p>
        <Badge variant={activity.variant}>{activity.label}</Badge>
      </div>
      <p className="break-all font-mono text-[11px] text-muted-foreground">
        {session.ref.workingDirectory}
      </p>
      {session.pendingInputCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          Pending input requests: {session.pendingInputCount}
        </p>
      ) : null}
    </li>
  );
}

function ImpactSessions({ impact }: { impact: RuntimeLifecycleImpact }): ReactElement {
  if (!hasLiveSessions(impact)) {
    return <p className="text-sm text-muted-foreground">{NO_IMPACT_MESSAGE}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground">{IMPACT_EXPLANATION}</p>
      {impact.workspaces
        .filter((workspace) => workspace.sessions.length > 0)
        .map((workspace) => (
          <section key={workspace.repoPath} className="space-y-2">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {workspace.workspaceName ?? workspace.repoPath}
              </p>
              <p className="break-all text-xs text-muted-foreground">{workspace.repoPath}</p>
            </div>
            <ul className="space-y-1.5">
              {workspace.sessions.map((session) => (
                <SessionRow
                  key={`${session.ref.runtimeKind}:${session.ref.externalSessionId}`}
                  session={session}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function PathChanges({ pathChanges }: { pathChanges: RuntimeImpactPathChange[] }): ReactElement {
  return (
    <ul className="space-y-1.5">
      {pathChanges.map((change) => (
        <li key={change.kind} className="rounded-md border border-border bg-muted p-2 text-xs">
          <p className="font-medium text-foreground">{change.label}</p>
          <p className="break-all text-muted-foreground">
            Old executable:{" "}
            <span className="font-mono">{change.oldExecutablePath || "Default"}</span>
          </p>
          <p className="break-all text-muted-foreground">
            New executable:{" "}
            <span className="font-mono">{change.newExecutablePath || "Default"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function ErrorText({ message }: { message: string }): ReactElement {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive-muted">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
