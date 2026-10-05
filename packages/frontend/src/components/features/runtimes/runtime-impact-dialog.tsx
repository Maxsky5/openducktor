import type {
  AgentSessionActivity,
  RuntimeKind,
  RuntimeLifecycleImpact,
  RuntimeLifecycleSessionImpact,
} from "@openducktor/contracts";
import {
  AlertTriangle,
  CircleCheck,
  CornerDownRight,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
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
  confirmIcon?: LucideIcon;
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
  confirmIcon,
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
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {pathChanges.length > 0 ? <PathChanges pathChanges={pathChanges} /> : null}
          {notice ? (
            <p className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-surface-foreground">
              {notice}
            </p>
          ) : null}
          {/* A later read keeps the shown sessions in place. Only the confirm button waits. */}
          {isLoadingImpact && impact === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              Loading affected sessions.
            </p>
          ) : null}
          {impactError !== null ? (
            <ErrorText message={`Affected sessions could not be read: ${impactError}`} />
          ) : null}
          {impactError === null && impact !== null ? <ImpactSessions impact={impact} /> : null}
          {error !== null ? <ErrorText message={error} /> : null}
        </DialogBody>
        <DialogFooter className="mt-0 flex-col-reverse gap-3 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            <ConfirmButtonIcon isPending={isPending} icon={confirmIcon} />
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

function ConfirmButtonIcon({
  isPending,
  icon: Icon,
}: {
  isPending: boolean;
  icon: LucideIcon | undefined;
}): ReactElement | null {
  if (isPending) return <LoaderCircle className="size-4 animate-spin" />;
  return Icon ? <Icon className="size-4" /> : null;
}

function SessionRow({ session }: { session: RuntimeLifecycleSessionImpact }): ReactElement {
  const activity = ACTIVITY_BADGES[session.activity];
  const isChild = session.parentExternalSessionId !== undefined;
  return (
    <li
      className={cn("flex items-start gap-3 px-3 py-2.5", isChild && "pl-8")}
      data-testid="runtime-impact-session"
    >
      {isChild ? (
        <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="min-w-0 break-words text-sm font-medium text-foreground">
          {isChild ? <span className="sr-only">Child session: </span> : null}
          {session.title}
        </p>
        <p
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={session.ref.workingDirectory}
        >
          {session.ref.workingDirectory}
        </p>
        {session.pendingInputCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Pending input requests: {session.pendingInputCount}
          </p>
        ) : null}
      </div>
      <Badge variant={activity.variant} className="shrink-0">
        {activity.label}
      </Badge>
    </li>
  );
}

function ImpactSessions({ impact }: { impact: RuntimeLifecycleImpact }): ReactElement {
  if (!hasLiveSessions(impact)) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <CircleCheck className="size-4 shrink-0 text-success-accent" aria-hidden />
        {NO_IMPACT_MESSAGE}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="flex gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-sm text-warning-surface-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{IMPACT_EXPLANATION}</span>
      </p>
      {impact.workspaces
        .filter((workspace) => workspace.sessions.length > 0)
        .map((workspace) => (
          <section
            key={workspace.repoPath}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="border-b border-border bg-muted/40 px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {workspace.workspaceName ?? workspace.repoPath}
              </p>
              <p
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={workspace.repoPath}
              >
                {workspace.repoPath}
              </p>
            </div>
            <ul className="divide-y divide-border">
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
    <ul className="space-y-2">
      {pathChanges.map((change) => (
        <li
          key={change.kind}
          className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs"
        >
          <p className="text-sm font-medium text-foreground">{change.label}</p>
          <p className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
            <span className="w-8 shrink-0">From</span>
            <span className="min-w-0 break-all font-mono">
              {change.oldExecutablePath || "Default"}
            </span>
          </p>
          <p className="flex min-w-0 items-baseline gap-2 text-foreground">
            <span className="w-8 shrink-0 text-muted-foreground">To</span>
            <span className="min-w-0 break-all font-mono">
              {change.newExecutablePath || "Default"}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function ErrorText({ message }: { message: string }): ReactElement {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2.5 text-sm text-destructive-surface-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}
