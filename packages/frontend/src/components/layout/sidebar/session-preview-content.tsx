import type { RuntimeWorkingDirectoryRef, WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowUpRight, CircleAlert, MessagesSquare } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { WorkflowRailPreview } from "@/components/features/agents/agent-studio-header-workflow-rail";
import { TaskHeaderBadges } from "@/components/features/tasks/task-header-badges";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildSessionPreviewModel,
  type SessionPreviewModel,
} from "@/features/session-navigation/session-preview-model";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { agentModelInfoParts } from "@/lib/agent-model-presentation";
import { statusBadgeClassName, statusLabel } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import { runtimeDefinitionsQueryOptions } from "@/state/queries/runtime";
import { createHostRuntimeCatalogOperations } from "@/state/operations/shared/runtime-catalog";
import {
  resolveRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import type {
  SessionNavigationEntry,
  SessionNavigationWorkspace,
} from "@/state/read-models/session-navigation-read-model";
import { useWorkspaceActivityProjection } from "@/state/workspace-activity/workspace-activity-context";
import { sessionEntryTimeText } from "./session-navigation-entry-model";
import { SessionEntryRuntimeIcon } from "./session-navigation-parts";
import { SessionPreviewPendingRequests } from "./session-preview-pending-input";
import { useSessionMenu } from "./session-menu-provider";

const { loadRuntimeCatalog } = createHostRuntimeCatalogOperations();

export function SessionPreviewContent({
  entry,
  now,
  titleId,
  onOpen,
  onOpenDialog,
  onCloseAutoFocus,
}: {
  entry: SessionNavigationEntry;
  now: number;
  titleId: string;
  onOpen: (target?: SessionNavigationTarget) => void;
  onOpenDialog: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const projection = useWorkspaceActivityProjection(entry.workspace.workspaceId);
  const details = useMemo(() => buildSessionPreviewModel(entry, projection), [entry, projection]);
  const task = entry.context.kind === "task" ? entry.context.task : null;
  const time = sessionEntryTimeText(entry, now);
  const statusIssue = entry.status.kind === "unavailable" ? entry.status.reason : entry.fault;
  return (
    <>
      <SessionPreviewHeader
        entry={entry}
        titleId={titleId}
        onOpenDialog={onOpenDialog}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <div className="space-y-3 border-t border-border px-4 py-3">
        {task ? (
          <section aria-label="Role lane">
            <WorkflowRailPreview
              steps={details.steps}
              selectedRole={entry.target.kind === "task_session" ? entry.target.role : null}
              onStepSelect={(role) => {
                const target = details.roleTargets.get(role);
                if (target) onOpen(target);
              }}
            />
          </section>
        ) : null}
        <SessionPreviewModelDetails entry={entry} model={details.model} />
        {statusIssue ? (
          <p
            role="alert"
            className="rounded-md border border-warning-border bg-warning-surface p-2 text-xs text-warning-muted"
          >
            {statusIssue}
          </p>
        ) : null}
        <SessionPreviewInput entry={entry} pending={details.pending} />
      </div>
      <footer className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-1.5">
        <div className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">
          {time ? <p>{time}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
          onClick={() => onOpen()}
        >
          Open session
          <ArrowUpRight className="size-3.5" />
        </Button>
      </footer>
    </>
  );
}

function SessionPreviewHeader({
  entry,
  titleId,
  onOpenDialog,
  onCloseAutoFocus,
}: {
  entry: SessionNavigationEntry;
  titleId: string;
  onOpenDialog: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const task = entry.context.kind === "task" ? entry.context.task : null;
  const workspaceSession = entry.context.kind === "workspace" ? entry.context.session : null;
  const customRole = workspaceSession?.roleSnapshot;
  return (
    <header className="space-y-3 p-4 pb-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={titleId} className="text-base font-semibold leading-snug text-foreground">
            {entry.title}
          </h3>
          {task ? <TaskIdBadge taskId={task.id} className="max-w-full" /> : null}
          {customRole ? (
            <div
              role="group"
              aria-label="Custom role"
              className="truncate text-xs font-medium text-muted-foreground"
              title={customRole.name}
            >
              {customRole.name}
            </div>
          ) : null}
        </div>
        {task ? (
          <Badge variant="outline" className={cn("shrink-0", statusBadgeClassName(task.status))}>
            {statusLabel(task.status)}
          </Badge>
        ) : null}
        {workspaceSession ? (
          <SessionPreviewArchiveButton
            workspace={entry.workspace}
            record={workspaceSession}
            onOpenDialog={onOpenDialog}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        ) : null}
      </div>
      {task ? (
        <div aria-label="Task details">
          <TaskHeaderBadges
            task={task}
            subtasksCount={task.subtaskIds.length}
            showQaPolicy={false}
          />
        </div>
      ) : null}
    </header>
  );
}

function SessionPreviewArchiveButton({
  workspace,
  record,
  onOpenDialog,
  onCloseAutoFocus,
}: {
  workspace: SessionNavigationWorkspace;
  record: WorkspaceSession;
  onOpenDialog: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const { requestDialog } = useSessionMenu();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      aria-label="Archive session"
      title="Archive session"
      onClick={() => {
        onOpenDialog();
        requestDialog({ action: "archive", workspace, record, onCloseAutoFocus });
      }}
    >
      <Archive className="size-4" aria-hidden="true" />
    </Button>
  );
}

function SessionPreviewModelDetails({
  entry,
  model,
}: {
  entry: SessionNavigationEntry;
  model: SessionPreviewModel["model"];
}): ReactElement {
  let runtimeRef: RuntimeWorkingDirectoryRef | null = null;
  if (entry.target.kind === "task_session") {
    const { runtimeKind, workingDirectory } = entry.target.identity;
    runtimeRef = { repoPath: entry.workspace.repoPath, runtimeKind, workingDirectory };
  } else if (entry.context.kind === "workspace") {
    const { runtimeKind, executionTarget } = entry.context.session;
    runtimeRef = {
      repoPath: entry.workspace.repoPath,
      runtimeKind,
      workingDirectory: executionTarget.workingDirectory,
    };
  }
  const enabled = runtimeRef !== null && model !== null;
  const catalogQuery = useQuery({
    ...(runtimeRef
      ? runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog)
      : skippedRuntimeCatalogQueryOptions()),
    enabled,
  });
  const surface = resolveRuntimeCatalogSurface(catalogQuery.data?.models, catalogQuery.error);
  let infoParts: string[];
  if (!model) infoParts = ["Model not recorded"];
  else if (enabled && catalogQuery.isPending) infoParts = ["Loading model details…"];
  else infoParts = agentModelInfoParts(model, surface.catalog);
  const label = infoParts.join(" · ");
  return (
    <div aria-label="Session configuration" className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <SessionEntryRuntimeIcon entry={entry} />
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </div>
      {surface.error ? (
        <p role="alert" className="text-xs text-destructive-muted">
          Could not load model details: {surface.error}
        </p>
      ) : null}
    </div>
  );
}

function SessionPreviewInput({
  entry,
  pending,
}: {
  entry: SessionNavigationEntry;
  pending: SessionPreviewModel["pending"];
}): ReactElement | null {
  const definitions = useQuery({
    ...runtimeDefinitionsQueryOptions(),
    enabled: pending.length > 0,
  });
  if (pending.length > 0)
    return (
      <section aria-label="Reply without opening the session" className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-warning-muted">
          <MessagesSquare className="size-3.5" />
          Reply here
        </div>
        {definitions.error ? (
          <p role="alert" className="text-xs text-destructive-muted">
            {definitions.error.message}
          </p>
        ) : null}
        {pending.map((input) => (
          <SessionPreviewPendingRequests
            key={agentSessionIdentityKey(input.ref)}
            input={input}
            workspaceId={entry.workspace.workspaceId}
            runtimeDefinitions={definitions.data ?? []}
          />
        ))}
      </section>
    );
  if (entry.attention.includes("blocked"))
    return (
      <p className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface p-3 text-xs text-warning-muted">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        This task is blocked. Open the session to review the blocker.
      </p>
    );
  return null;
}
