import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { IncompleteWorkspaceRemoval, WorkspaceRecord } from "@openducktor/contracts";
import { EyeOff, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type RefCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getShellBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state/app-state-provider";
import {
  WorkspaceCloseDialog,
  WorkspaceRemovalRecoveryDialog,
  WorkspaceRemoveDialog,
} from "../features/repository/workspace-lifecycle-dialogs";
import { WorkspaceAvatar } from "../features/repository/workspace-identity";

const DRAG_DISTANCE_PX = 6;

const cancelPendingAnimationFrame = (frameRef: { current: number | null }): void => {
  const pendingFrame = frameRef.current;
  if (pendingFrame !== null) {
    globalThis.cancelAnimationFrame(pendingFrame);
    frameRef.current = null;
  }
};

type WorkspaceRailButtonShellProps = {
  workspace: WorkspaceRecord;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  shellRef?: RefCallback<HTMLDivElement>;
  style?: CSSProperties;
  dragState: {
    isSource?: boolean;
    isOverlay?: boolean;
    shouldSuppressSelection?: boolean;
  };
  interactionState: {
    isSwitchingWorkspace: boolean;
  };
  onSelectWorkspace?: (workspaceId: string) => void;
};

function WorkspaceRailButtonShell({
  workspace,
  dragListeners,
  shellRef,
  style,
  dragState,
  interactionState,
  onSelectWorkspace,
}: WorkspaceRailButtonShellProps): ReactElement {
  const isDragSource = dragState.isSource === true;
  const isDragOverlay = dragState.isOverlay === true;
  const shouldSuppressSelection = dragState.shouldSuppressSelection === true;
  const { isSwitchingWorkspace } = interactionState;
  const isInteractionDisabled = isSwitchingWorkspace && !isDragOverlay;

  return (
    <div
      ref={shellRef}
      data-active={workspace.isActive ? "true" : "false"}
      data-dragging={isDragSource ? "true" : "false"}
      style={style}
      className={cn("touch-none", isDragSource && !isDragOverlay && "opacity-0")}
      {...dragListeners}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "size-10 rounded-lg border-none p-0 shadow-sm transition-none",
          workspace.isActive
            ? "bg-primary text-primary-foreground hover:bg-primary"
            : "bg-card text-foreground hover:bg-card",
          isDragOverlay && "pointer-events-none",
        )}
        aria-label={workspace.workspaceName}
        title={workspace.workspaceName}
        aria-disabled={isInteractionDisabled ? true : undefined}
        onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
          if (isDragOverlay || isInteractionDisabled) {
            return;
          }
          event.preventDefault();
        }}
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          if (
            isDragOverlay ||
            shouldSuppressSelection ||
            workspace.isActive ||
            isInteractionDisabled
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          onSelectWorkspace?.(workspace.workspaceId);
        }}
      >
        <WorkspaceAvatar workspace={workspace} />
      </Button>
    </div>
  );
}

function SortableWorkspaceRailButton({
  workspace,
  isActiveDrag,
  shouldSuppressSelection,
  isSwitchingWorkspace,
  onSelectWorkspace,
  onRequestCloseWorkspace,
  onRequestRemoveWorkspace,
}: {
  workspace: WorkspaceRecord;
  isActiveDrag: boolean;
  shouldSuppressSelection: boolean;
  isSwitchingWorkspace: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onRequestCloseWorkspace: (workspace: WorkspaceRecord) => void;
  onRequestRemoveWorkspace: (workspace: WorkspaceRecord) => void;
}): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.workspaceId,
    disabled: isSwitchingWorkspace,
    transition: {
      duration: 180,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="block"
        onContextMenu={() => {
          getShellBridge().claimContextMenu?.();
        }}
      >
        <WorkspaceRailButtonShell
          workspace={workspace}
          shellRef={setNodeRef}
          dragListeners={isSwitchingWorkspace ? undefined : listeners}
          dragState={{
            isSource: (isDragging || isActiveDrag) && !isSwitchingWorkspace,
            shouldSuppressSelection,
          }}
          interactionState={{ isSwitchingWorkspace }}
          onSelectWorkspace={onSelectWorkspace}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => onRequestCloseWorkspace(workspace)}>
          <EyeOff />
          Close workspace
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => onRequestRemoveWorkspace(workspace)}>
          <Trash2 />
          Remove workspace
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WorkspaceRail({
  onOpenRepositoryModal,
}: {
  onOpenRepositoryModal: () => void;
}): ReactElement {
  const {
    workspaces,
    incompleteRemovals,
    selectWorkspace,
    reorderWorkspaces,
    isSwitchingWorkspace,
  } = useWorkspaceState();
  const [lifecycleRequest, setLifecycleRequest] = useState<
    | { action: "close" | "remove"; workspace: WorkspaceRecord }
    | { action: "recovery"; removal: IncompleteWorkspaceRemoval }
    | null
  >(null);
  const workspaceIds = useMemo(
    () => workspaces.map((workspace) => workspace.workspaceId),
    [workspaces],
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const suppressedSelectionWorkspaceIdRef = useRef<string | null>(null);
  const selectionSuppressionFrameRef = useRef<number | null>(null);
  const activeDragWorkspace = activeWorkspaceId
    ? (workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId) ?? null)
    : null;
  const PrimarySensor = globalThis.PointerEvent === undefined ? MouseSensor : PointerSensor;
  const sensors = useSensors(
    useSensor(PrimarySensor, {
      activationConstraint: {
        distance: DRAG_DISTANCE_PX,
      },
    }),
  );

  const scheduleSelectionSuppressionClear = (): void => {
    cancelPendingAnimationFrame(selectionSuppressionFrameRef);

    selectionSuppressionFrameRef.current = globalThis.requestAnimationFrame(() => {
      suppressedSelectionWorkspaceIdRef.current = null;
      selectionSuppressionFrameRef.current = null;
    });
  };

  useEffect(() => {
    return () => cancelPendingAnimationFrame(selectionSuppressionFrameRef);
  }, []);

  const handleDragStart = (event: DragStartEvent): void => {
    const workspaceId = String(event.active.id);
    suppressedSelectionWorkspaceIdRef.current = workspaceId;
    setActiveWorkspaceId(workspaceId);
  };

  const handleDragCancel = (): void => {
    setActiveWorkspaceId(null);
    scheduleSelectionSuppressionClear();
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const draggedWorkspaceId = String(event.active.id);
    const overWorkspaceId = event.over ? String(event.over.id) : null;
    setActiveWorkspaceId(null);
    scheduleSelectionSuppressionClear();

    if (!overWorkspaceId || draggedWorkspaceId === overWorkspaceId) {
      return;
    }

    const draggedIndex = workspaceIds.indexOf(draggedWorkspaceId);
    const overIndex = workspaceIds.indexOf(overWorkspaceId);
    if (draggedIndex < 0 || overIndex < 0) {
      return;
    }

    void reorderWorkspaces(arrayMove(workspaceIds, draggedIndex, overIndex));
  };

  return (
    <>
      <aside className="workspace-rail flex h-full w-14 shrink-0 flex-col border-r border-border bg-background">
        <div className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {workspaces.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              measuring={{
                droppable: {
                  strategy: MeasuringStrategy.Always,
                },
              }}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {workspaces.map((workspace) => (
                    <SortableWorkspaceRailButton
                      key={workspace.workspaceId}
                      workspace={workspace}
                      isActiveDrag={activeWorkspaceId === workspace.workspaceId}
                      shouldSuppressSelection={
                        suppressedSelectionWorkspaceIdRef.current === workspace.workspaceId
                      }
                      isSwitchingWorkspace={isSwitchingWorkspace}
                      onSelectWorkspace={(workspaceId) => {
                        void selectWorkspace(workspaceId);
                      }}
                      onRequestCloseWorkspace={(workspace) =>
                        setLifecycleRequest({ action: "close", workspace })
                      }
                      onRequestRemoveWorkspace={(workspace) =>
                        setLifecycleRequest({ action: "remove", workspace })
                      }
                    />
                  ))}
                </div>
              </SortableContext>

              <DragOverlay
                dropAnimation={{
                  duration: 220,
                  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                zIndex={40}
              >
                {activeDragWorkspace ? (
                  <WorkspaceRailButtonShell
                    workspace={activeDragWorkspace}
                    dragState={{ isOverlay: true }}
                    interactionState={{ isSwitchingWorkspace }}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : null}

          {incompleteRemovals.map((removal) => (
            <Button
              key={removal.workspace.workspaceId}
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 text-destructive hover:text-destructive"
              aria-label={`Finish removing ${removal.workspace.workspaceName}`}
              title={`Finish removing ${removal.workspace.workspaceName}`}
              onClick={() => setLifecycleRequest({ action: "recovery", removal })}
            >
              <TriangleAlert className="size-5" />
            </Button>
          ))}

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-10"
            aria-label="Open repository"
            title="Open repository"
            onClick={onOpenRepositoryModal}
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </aside>
      {lifecycleRequest?.action === "close" ? (
        <WorkspaceCloseDialog
          workspace={lifecycleRequest.workspace}
          onOpenChange={(open) => {
            if (!open) setLifecycleRequest(null);
          }}
        />
      ) : null}
      {lifecycleRequest?.action === "remove" ? (
        <WorkspaceRemoveDialog
          workspace={lifecycleRequest.workspace}
          onOpenChange={(open) => {
            if (!open) setLifecycleRequest(null);
          }}
        />
      ) : null}
      {lifecycleRequest?.action === "recovery" ? (
        <WorkspaceRemovalRecoveryDialog
          removal={
            incompleteRemovals.find(
              (removal) =>
                removal.workspace.workspaceId === lifecycleRequest.removal.workspace.workspaceId,
            ) ?? lifecycleRequest.removal
          }
          onOpenChange={(open) => {
            if (!open) setLifecycleRequest(null);
          }}
        />
      ) : null}
    </>
  );
}
