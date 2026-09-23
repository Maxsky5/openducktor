import type { WorkspaceSession } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, History, LoaderCircle, Plus } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { BrowserTabs, BrowserTabsBar, BrowserTabsRoot } from "@/components/ui/browser-tabs";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  useActiveWorkspace,
  useAgentActivitySnapshot,
  useAgentSessionReadModelState,
} from "@/state/app-state-provider";
import { host } from "@/state/operations/host";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
} from "@/state/queries/workspace-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  WorkspaceSessionContent,
  WorkspaceSessionReadModelNotice,
} from "./workspace-session-content";
import { WorkspaceSessionCreateDialog } from "./workspace-session-create-dialog";
import { WorkspaceSessionEmptyState } from "./workspace-session-empty-state";
import { WorkspaceSessionHistoryDialog } from "./workspace-session-history-dialog";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { useMountedRef } from "./use-mounted-ref";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useWorkspaceSessionTabOrder } from "./use-workspace-session-tab-order";

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
  const running = isAgentSessionActivityActive(activity);
  const title = workspaceSessionTitle(record);
  return (
    <>
      <span
        aria-label={statusLabel}
        className={cn(
          "mx-1 size-2 shrink-0 rounded-full bg-input",
          running && "bg-status-running",
          activity === "waiting_input" && "bg-warning-accent",
          activity === "error" && "bg-destructive",
        )}
      />
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

type WorkspaceSessionsProps = { workspace: ActiveWorkspace };

function WorkspaceSessionTabs({
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

function WorkspaceSessionArchiveError({ error }: { error: Error | null }): ReactElement | null {
  if (!error) return null;
  return (
    <p role="alert" className="p-3 text-sm text-destructive">
      {errorMessage(error)}
    </p>
  );
}

function WorkspaceSessions({ workspace }: WorkspaceSessionsProps): ReactElement {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { sessionId, creating, updateNavigation } = useWorkspaceSessionNavigation({
    locationKey: location.key,
    navigationType,
    searchParams: params,
    setSearchParams: setParams,
  });
  const records = useQuery(workspaceSessionListQueryOptions(workspace.workspaceId));
  const { sessions: orderedSessions, reorder } = useWorkspaceSessionTabOrder(
    workspace.workspaceId,
    records.data,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceSession | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const mounted = useMountedRef();
  const selected = useWorkspaceSessionSelection({
    workspaceId: workspace.workspaceId,
    sessions: records.data === undefined ? undefined : orderedSessions,
    requestedSessionId: sessionId,
  });
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (records.data && sessionId !== selectedId) updateNavigation({ sessionId: selectedId });
  }, [records.data, selectedId, sessionId, updateNavigation]);
  const archive = useMutation({
    mutationFn: (input: { sessionId: string; confirmStop: boolean; removeWorktree: boolean }) =>
      host.workspaceSessionArchive({ workspaceId: workspace.workspaceId, ...input }),
    onSuccess: (record) => {
      updateWorkspaceSessionQueries(queryClient, workspace.workspaceId, record);
      if (!mounted.current) return;
      setArchiveTarget(null);
      if (selectedId === record.id)
        updateNavigation({
          sessionId: orderedSessions.find((entry) => entry.id !== record.id)?.id ?? null,
        });
    },
    onSettled: () => {
      void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
    },
  });
  const archivingId = archive.isPending ? (archive.variables?.sessionId ?? null) : null;
  const beginArchive = (sessionId: string, removeWorktree: boolean) => {
    archive.reset();
    archive.mutate({ sessionId, confirmStop: true, removeWorktree });
  };
  const handleTabArchive = (target: WorkspaceSession) => {
    archive.reset();
    if (target.executionTarget.kind === "local_worktree") {
      setArchiveTarget(target);
      return;
    }
    beginArchive(target.id, false);
  };
  const setCreating = (open: boolean) => {
    setCreateOpen(open);
    if (!open && creating) updateNavigation({ creating: false });
  };
  if (records.isPending)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading chats…
      </p>
    );
  if (records.isError)
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-destructive">Could not load chats: {errorMessage(records.error)}</p>
        <Button variant="outline" onClick={() => void records.refetch()}>
          Retry
        </Button>
      </div>
    );
  return (
    <BrowserTabsRoot
      value={selectedId ?? ""}
      onValueChange={(sessionId) => updateNavigation({ sessionId }, false)}
      className="h-full min-h-0 min-w-0 gap-0 overflow-hidden"
    >
      <BrowserTabsBar
        className="agent-studio-titlebar-safe-area electron-titlebar-safe-area bg-studio-chrome"
        createAction={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-md border-none border-transparent bg-transparent p-0 text-studio-chrome-foreground shadow-none hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label="New chat"
            title="New chat"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-5" />
          </Button>
        }
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-studio-chrome-foreground hover:bg-transparent"
            aria-label="Session history"
            title="Archived chats"
            onClick={() => setHistoryOpen(true)}
          >
            <History />
          </Button>
        }
      >
        <WorkspaceSessionTabs
          sessions={orderedSessions}
          selectedId={selectedId}
          archivingId={archivingId}
          pending={archive.isPending}
          onReorder={reorder}
          onArchive={handleTabArchive}
        />
      </BrowserTabsBar>
      <WorkspaceSessionReadModelNotice />
      {archiveTarget === null && <WorkspaceSessionArchiveError error={archive.error} />}
      {selected ? (
        <WorkspaceSessionContent key={selected.id} workspace={workspace} record={selected} />
      ) : (
        <WorkspaceSessionEmptyState
          hasSessions={records.data.length > 0}
          onCreate={() => setCreating(true)}
        />
      )}
      {historyOpen && (
        <WorkspaceSessionHistoryDialog
          workspaceId={workspace.workspaceId}
          repoPath={workspace.repoPath}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {archiveTarget && (
        <WorkspaceSessionArchiveDialog
          key={archiveTarget.id}
          workspaceId={workspace.workspaceId}
          record={archiveTarget}
          isArchiving={archive.isPending}
          error={archive.error}
          onArchive={(removeWorktree) => beginArchive(archiveTarget.id, removeWorktree)}
          onClose={() => {
            setArchiveTarget(null);
            archive.reset();
          }}
        />
      )}
      {(createOpen || creating) && (
        <WorkspaceSessionCreateDialog
          workspace={workspace}
          onClose={() => setCreating(false)}
          onCreated={(record) => {
            if (mounted.current) {
              setCreateOpen(false);
              updateNavigation({ sessionId: record.id, creating: false });
            }
          }}
        />
      )}
    </BrowserTabsRoot>
  );
}

export default function WorkspaceSessionsPage() {
  const workspace = useActiveWorkspace();
  if (!workspace) return <p className="p-6">Select a workspace.</p>;
  return (
    <DiffWorkerProvider>
      <WorkspaceSessions key={workspace.workspaceId} workspace={workspace} />
    </DiffWorkerProvider>
  );
}
