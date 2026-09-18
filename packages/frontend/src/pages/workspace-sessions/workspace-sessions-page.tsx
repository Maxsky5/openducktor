import { DndContext, DragOverlay } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WorkspaceSession } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, History, LoaderCircle, MessageCirclePlus, Plus } from "lucide-react";
import { type ComponentProps, type ReactElement, useEffect, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import {
  horizontalTabDropAnimation,
  horizontalTabSortTransition,
  useHorizontalSortableTabs,
} from "@/components/ui/use-horizontal-sortable-tabs";
import {
  StudioTabStrip,
  StudioTabsList,
  StudioTabTrigger,
} from "@/components/features/agents/studio-tab-strip";
import { studioTabShellClassName } from "@/components/features/agents/studio-tab-styles";
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
import { WorkspaceSessionHistoryDialog } from "./workspace-session-history-dialog";
import { WorkspaceSessionArchiveDialog } from "./workspace-session-archive-dialog";
import { useMountedRef } from "./use-mounted-ref";
import { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";
import { useWorkspaceSessionSelection } from "./use-workspace-session-selection";
import { useWorkspaceSessionTabOrder } from "./use-workspace-session-tab-order";

type WorkspaceSessionTabProps = {
  record: WorkspaceSession;
  selected: boolean;
  pending: boolean;
  confirming: boolean;
  archiving: boolean;
  onArchive?: (record: WorkspaceSession) => void;
  onSelect?: (id: string) => void;
  shouldSuppressSelection?: (id: string) => boolean;
};

function WorkspaceSessionTab(props: WorkspaceSessionTabProps): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.record.id,
    transition: horizontalTabSortTransition,
  });
  return (
    <WorkspaceSessionTabView
      {...props}
      shellProps={{
        ...listeners,
        ref: setNodeRef,
        className: isDragging ? "opacity-0" : undefined,
        style: { transform: CSS.Transform.toString(transform), transition },
      }}
    />
  );
}

const archiveButtonLabel = (title: string, confirming: boolean, archiving: boolean): string => {
  if (archiving) return `Archiving ${title}`;
  if (confirming) return `Confirm stop and archive ${title}`;
  return `Archive ${title}`;
};

function WorkspaceSessionTabView({
  record,
  selected,
  pending,
  confirming,
  archiving,
  onArchive,
  onSelect,
  shouldSuppressSelection,
  shellProps,
}: WorkspaceSessionTabProps & { shellProps?: ComponentProps<"div"> }): ReactElement {
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
  const archiveLabel = archiveButtonLabel(title, confirming, archiving);
  return (
    <div
      {...shellProps}
      className={cn(studioTabShellClassName(selected), "touch-none", shellProps?.className)}
      data-workspace-session-tab-id={record.id}
    >
      <StudioTabTrigger
        value={record.id}
        title={title}
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          if (shouldSuppressSelection?.(record.id)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelect?.(record.id);
        }}
      >
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
      </StudioTabTrigger>
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
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onArchive?.(record)}
      >
        {archiving ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <>
            <Archive
              aria-hidden="true"
              className={cn(
                "absolute transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                confirming ? "scale-75 -rotate-45 opacity-0" : "scale-100 rotate-0 opacity-100",
              )}
            />
            <Check
              aria-hidden="true"
              className={cn(
                "absolute transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                confirming ? "scale-100 rotate-0 opacity-100" : "scale-75 rotate-45 opacity-0",
              )}
            />
          </>
        )}
      </Button>
    </div>
  );
}

type WorkspaceSessionsProps = { workspace: ActiveWorkspace };

function WorkspaceSessionTabDragPreview({
  record,
  selectedId,
  pending,
  confirming,
  archiving,
}: {
  record: WorkspaceSession | undefined;
  selectedId: string | null;
  pending: boolean;
  confirming: boolean;
  archiving: boolean;
}): ReactElement | null {
  if (!record) return null;
  return (
    <div aria-hidden="true" inert>
      <Tabs value={selectedId ?? ""}>
        <StudioTabsList>
          <WorkspaceSessionTabView
            record={record}
            selected={record.id === selectedId}
            pending={pending}
            confirming={confirming}
            archiving={archiving}
          />
        </StudioTabsList>
      </Tabs>
    </div>
  );
}

function WorkspaceSessionTabs({
  sessions,
  selectedId,
  archivingId,
  pending,
  onReorder,
  onSelect,
  onArchive,
}: {
  sessions: WorkspaceSession[];
  selectedId: string | null;
  archivingId: string | null;
  pending: boolean;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
  onSelect: (id: string) => void;
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
  const tabIds = sessions.map((record) => record.id);
  const drag = useHorizontalSortableTabs({ itemIds: tabIds, onReorder });
  const activeDragRecord = sessions.find((record) => record.id === drag.activeId);
  return (
    <DndContext
      sensors={drag.sensors}
      collisionDetection={drag.collisionDetection}
      measuring={drag.measuring}
      modifiers={drag.modifiers}
      onDragStart={drag.handleDragStart}
      onDragEnd={drag.handleDragEnd}
      onDragCancel={drag.handleDragCancel}
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        <StudioTabsList aria-label="Workspace session tabs">
          {sessions.map((record) => (
            <WorkspaceSessionTab
              key={record.id}
              record={record}
              selected={record.id === selectedId}
              pending={pending}
              confirming={confirmingId === record.id}
              archiving={archivingId === record.id}
              onSelect={onSelect}
              onArchive={handleArchive}
              shouldSuppressSelection={drag.shouldSuppressSelection}
            />
          ))}
        </StudioTabsList>
      </SortableContext>
      <DragOverlay dropAnimation={horizontalTabDropAnimation} zIndex={40}>
        <WorkspaceSessionTabDragPreview
          record={activeDragRecord}
          selectedId={selectedId}
          pending={pending}
          confirming={confirmingId === activeDragRecord?.id}
          archiving={archivingId === activeDragRecord?.id}
        />
      </DragOverlay>
    </DndContext>
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
    <Tabs
      value={selectedId ?? ""}
      onValueChange={(sessionId) => updateNavigation({ sessionId }, false)}
      className="h-full min-h-0 min-w-0 gap-0 overflow-hidden"
    >
      <StudioTabStrip
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
          onSelect={(sessionId) => updateNavigation({ sessionId }, false)}
          onArchive={handleTabArchive}
        />
      </StudioTabStrip>
      <WorkspaceSessionReadModelNotice />
      {archive.error && !archiveTarget && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {errorMessage(archive.error)}
        </p>
      )}
      {selected ? (
        <WorkspaceSessionContent key={selected.id} workspace={workspace} record={selected} />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-card p-6 text-center">
          <MessageCirclePlus className="size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Workspace chat</h1>
          <p className="text-muted-foreground">
            {records.data.length ? "Select a session above." : "No active sessions."}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Work with an agent outside a task. Choose a repository or worktree and start a
            conversation.
          </p>
          <Button onClick={() => setCreating(true)}>
            <MessageCirclePlus />
            New chat
          </Button>
        </section>
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
    </Tabs>
  );
}

export default function WorkspaceSessionsPage() {
  const workspace = useActiveWorkspace();
  if (!workspace) return <p className="p-6">Select a workspace.</p>;
  return <WorkspaceSessions key={workspace.workspaceId} workspace={workspace} />;
}
