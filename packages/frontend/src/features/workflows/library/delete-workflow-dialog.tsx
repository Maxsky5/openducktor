import type { WorkflowLibraryEntry, WorkflowTaskGroup } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useRequiredTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import {
  workflowTaskUseQueryOptions,
  workflowVersionsQueryOptions,
} from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Trash2 } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";
import {
  ConfirmDialog,
  type ConfirmImpactCopy,
  ConfirmSubject,
} from "@/components/features/confirm/confirm-dialog";
import { issueTypeStyle } from "@/components/features/kanban/kanban-task-badge-model";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneBadgeClassName } from "@/lib/task-status-presentation";
import { useWorkspaceState } from "@/state";
import { useDeleteWorkflow } from "../use-workflow-library-commands";

const countText = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

/** What stops the delete: the default role and open tasks. Closed tasks keep the versions. */
const useDeleteCheck = (entry: WorkflowLibraryEntry | null, isDefault: boolean) => {
  const versioned = entry !== null && entry.latestVersion !== null;
  const use = useQuery({ ...workflowTaskUseQueryOptions(entry?.id ?? ""), enabled: versioned });
  const versions = useQuery({
    ...workflowVersionsQueryOptions(entry?.id ?? ""),
    enabled: versioned,
  });
  const groups = use.data?.openTasks ?? [];
  const openTaskCount = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const checking = versioned && (use.isPending || versions.isPending);
  return {
    checking,
    blocked: !checking && (isDefault || openTaskCount > 0),
    groups,
    openTaskCount,
    closedTaskCount: use.data?.closedTaskCount ?? 0,
    versionCount: versions.data?.length ?? 0,
    readError: use.error ?? versions.error,
  };
};
type DeleteCheck = ReturnType<typeof useDeleteCheck>;

/** One line that says what the delete does, or what stops it. */
const deleteDescription = (
  entry: WorkflowLibraryEntry | null,
  isDefault: boolean,
  { blocked, openTaskCount, closedTaskCount }: DeleteCheck,
): string => {
  if (!entry || !blocked)
    return closedTaskCount > 0
      ? "Delete this workflow. Its closed tasks keep the versions that they use."
      : "Delete this workflow and everything it saved.";
  const tasks =
    openTaskCount === 0
      ? null
      : openTaskCount === 1
        ? "1 open task uses it"
        : `${openTaskCount} open tasks use it`;
  if (tasks && isDefault)
    return `It is the default workflow, and ${tasks}. Clear both before you delete it.`;
  if (tasks) return `${tasks}. Close or delete ${openTaskCount === 1 ? "it" : "them"} first.`;
  return "It is the default workflow. Make another workflow the default first.";
};

/** What the delete removes and keeps. Closed tasks keep the published versions. */
const deleteImpact = (
  entry: WorkflowLibraryEntry | null,
  { checking, blocked, versionCount, closedTaskCount }: DeleteCheck,
): ConfirmImpactCopy | null => {
  if (!entry || blocked || checking) return null;
  const keepsVersions = closedTaskCount > 0 && versionCount > 0;
  const versions = countText(versionCount, "published version", "published versions");
  return {
    changes: [
      "Delete the workflow",
      ...(versionCount > 0 && !keepsVersions ? [`Delete its ${versions}`] : []),
      ...(entry.draft === null ? [] : ["Delete its draft"]),
    ],
    kept: keepsVersions
      ? [`Keep its ${versions} for ${countText(closedTaskCount, "closed task", "closed tasks")}`]
      : undefined,
    warning: "This cannot be undone.",
  };
};

/** A titled list of the blocker list, such as the open tasks of one repository. */
function BlockerSection({
  title,
  leading,
  count,
  children,
}: {
  title: string;
  leading?: ReactNode;
  count?: number;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {leading}
        {title}
        {count === undefined ? null : (
          <span className="rounded-full bg-muted px-1.5 py-px text-[11px] tabular-nums">
            {count}
          </span>
        )}
      </h3>
      <ul className="flex flex-col rounded-lg border border-border p-1">{children}</ul>
    </section>
  );
}

type OpenTask = WorkflowTaskGroup["tasks"][number];

/** One open task, as the command palette shows a task: type, title, ID, and state. */
function TaskRow({ task, onOpen }: { task: OpenTask; onOpen: () => void }): ReactElement {
  const issueType = issueTypeStyle(task.issueType);
  const IssueTypeIcon = issueType.icon;
  return (
    <li>
      <button
        type="button"
        aria-label={`Open task ${task.title}`}
        title={task.title}
        onClick={onOpen}
        className="group/row flex h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IssueTypeIcon
          className={cn("size-4 shrink-0", issueType.iconClassName)}
          aria-label={issueType.label}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
        <span className="max-w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {task.taskId}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "h-5 shrink-0 rounded-full px-2 py-0 text-[10px] font-medium",
            toneBadgeClassName(task.state.tone ?? "neutral"),
          )}
        >
          {task.state.label}
        </Badge>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground group-hover/row:text-foreground"
        />
      </button>
    </li>
  );
}

/** The open tasks that use the workflow, by repository. A row opens the details of the task. */
function TaskUses({
  groups,
  onOpen,
}: {
  groups: readonly WorkflowTaskGroup[];
  onOpen: (workspaceId: string, taskId: string) => void;
}): ReactElement {
  const { workspaces } = useWorkspaceState();
  return (
    <>
      {groups.map((group) => {
        const workspace = workspaces.find(({ workspaceId }) => workspaceId === group.workspaceId);
        return (
          <BlockerSection
            key={group.workspaceId}
            title={`Open tasks in ${group.repoName}`}
            leading={
              workspace ? (
                <WorkspaceTile workspace={workspace} size="xs" className="shadow-none" />
              ) : null
            }
            count={group.tasks.length}
          >
            {group.tasks.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                onOpen={() => onOpen(group.workspaceId, task.taskId)}
              />
            ))}
          </BlockerSection>
        );
      })}
    </>
  );
}

/**
 * Closes the dialog and opens the details sheet of a task on this page. The sheet shows tasks of
 * the selected repository, so a task of another repository selects that repository first.
 */
const useOpenTask = (close: () => void) => {
  const { onOpenTaskDetails } = useRequiredTaskWorkflowActions();
  const { activeWorkspace, selectWorkspace } = useWorkspaceState();
  const pendingTask = useRef<{ workspaceId: string; taskId: string } | null>(null);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  // The sheet of the new repository mounts in the commit of the switch, so it opens the task now.
  useEffect(() => {
    const pending = pendingTask.current;
    if (!pending || pending.workspaceId !== activeWorkspaceId) return;
    pendingTask.current = null;
    onOpenTaskDetails(pending.taskId);
  }, [activeWorkspaceId, onOpenTaskDetails]);
  return (workspaceId: string, taskId: string) => {
    close();
    if (workspaceId === activeWorkspaceId) return onOpenTaskDetails(taskId);
    pendingTask.current = { workspaceId, taskId };
    // The selection shows its own error toast.
    selectWorkspace(workspaceId).catch(() => {
      pendingTask.current = null;
    });
  };
};

/**
 * Confirms the delete of a custom workflow. While it is the default or open tasks use it, the
 * dialog names each blocker with the action that clears it, and offers only Close. The host checks
 * again on delete.
 */
export function DeleteWorkflowDialog({
  entry,
  isDefault,
  onClose,
}: {
  /** The workflow to delete, as the library reads it now. Null closes the dialog. */
  entry: WorkflowLibraryEntry | null;
  /** Whether new tasks use the workflow by default. */
  isDefault: boolean;
  onClose: () => void;
}): ReactElement {
  const check = useDeleteCheck(entry, isDefault);
  const deleteWorkflow = useDeleteWorkflow();
  const close = () => {
    deleteWorkflow.reset();
    onClose();
  };
  const openTask = useOpenTask(close);
  const failure = deleteWorkflow.error ?? check.readError;
  return (
    <ConfirmDialog
      open={entry !== null}
      onOpenChange={(open) => !open && close()}
      title="Delete workflow"
      description={deleteDescription(entry, isDefault, check)}
      icon={Trash2}
      subject={entry ? <ConfirmSubject name={entry.name} id={entry.id} /> : null}
      impact={deleteImpact(entry, check)}
      confirmLabel={check.blocked ? null : "Delete workflow"}
      variant="destructive"
      pending={deleteWorkflow.isPending}
      error={failure ? errorMessage(failure) : null}
      confirmDisabled={check.checking || check.readError !== null}
      loading={check.checking}
      loadingLabel="Checking what uses the workflow…"
      onConfirm={() =>
        entry && deleteWorkflow.mutate({ workflowId: entry.id }, { onSuccess: close })
      }
    >
      {check.blocked && entry ? <TaskUses groups={check.groups} onOpen={openTask} /> : null}
    </ConfirmDialog>
  );
}
