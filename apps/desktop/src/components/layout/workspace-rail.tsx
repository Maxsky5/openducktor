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
import type { WorkspaceRecord } from "@openducktor/contracts";
import { Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state";

const DRAG_DISTANCE_PX = 6;

const deriveWorkspaceInitials = (workspaceName: string): string => {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    return "?";
  }

  const segments = trimmedName
    .split(/[^A-Za-z0-9]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length >= 2) {
    return `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  }

  return trimmedName.slice(0, 2).toUpperCase();
};

function WorkspaceRailAvatar({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  const [failedIconDataUrl, setFailedIconDataUrl] = useState<string | null>(null);
  const iconDataUrl = workspace.iconDataUrl ?? null;

  if (iconDataUrl && failedIconDataUrl !== iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        aria-hidden="true"
        className="size-6 rounded-md object-cover"
        onError={() => setFailedIconDataUrl(iconDataUrl)}
      />
    );
  }

  return (
    <span className="text-xs font-semibold uppercase">
      {deriveWorkspaceInitials(workspace.workspaceName)}
    </span>
  );
}

type WorkspaceRailButtonShellProps = {
  workspace: WorkspaceRecord;
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  shellRef?: RefCallback<HTMLDivElement>;
  style?: CSSProperties;
  isDragSource?: boolean;
  isDragOverlay?: boolean;
  shouldSuppressSelection?: boolean;
  isSwitchingWorkspace: boolean;
  onSelectWorkspace?: (workspaceId: string) => void;
};

function WorkspaceRailButtonShell({
  workspace,
  dragListeners,
  shellRef,
  style,
  isDragSource = false,
  isDragOverlay = false,
  shouldSuppressSelection = false,
  isSwitchingWorkspace,
  onSelectWorkspace,
}: WorkspaceRailButtonShellProps): ReactElement {
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
          "size-10 rounded-lg border-none p-0 shadow-sm",
          workspace.isActive
            ? "bg-primary text-primary-foreground hover:bg-primary"
            : "bg-card text-foreground hover:bg-card",
          isDragOverlay && "pointer-events-none",
        )}
        aria-label={workspace.workspaceName}
        title={workspace.workspaceName}
        disabled={isInteractionDisabled}
        onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => {
          if (isDragOverlay) {
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
        <WorkspaceRailAvatar workspace={workspace} />
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
}: {
  workspace: WorkspaceRecord;
  isActiveDrag: boolean;
  shouldSuppressSelection: boolean;
  isSwitchingWorkspace: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
}): ReactElement {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.workspaceId,
    transition: {
      duration: 180,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });

  return (
    <WorkspaceRailButtonShell
      workspace={workspace}
      shellRef={setNodeRef}
      dragListeners={listeners}
      isDragSource={isDragging || isActiveDrag}
      shouldSuppressSelection={shouldSuppressSelection}
      isSwitchingWorkspace={isSwitchingWorkspace}
      onSelectWorkspace={onSelectWorkspace}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    />
  );
}

export function WorkspaceRail({
  onOpenRepositoryModal,
}: {
  onOpenRepositoryModal: () => void;
}): ReactElement {
  const { workspaces, selectWorkspace, reorderWorkspaces, isSwitchingWorkspace } =
    useWorkspaceState();
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
  const PrimarySensor = typeof globalThis.PointerEvent === "function" ? PointerSensor : MouseSensor;
  const sensors = useSensors(
    useSensor(PrimarySensor, {
      activationConstraint: {
        distance: DRAG_DISTANCE_PX,
      },
    }),
  );

  const scheduleSelectionSuppressionClear = (): void => {
    if (selectionSuppressionFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(selectionSuppressionFrameRef.current);
    }

    selectionSuppressionFrameRef.current = globalThis.requestAnimationFrame(() => {
      suppressedSelectionWorkspaceIdRef.current = null;
      selectionSuppressionFrameRef.current = null;
    });
  };

  useEffect(() => {
    return () => {
      if (selectionSuppressionFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(selectionSuppressionFrameRef.current);
      }
    };
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
    <aside className="flex h-full w-14 shrink-0 flex-col border-r border-border bg-background">
      <div className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
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
                  isDragOverlay
                  isSwitchingWorkspace={isSwitchingWorkspace}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-10 rounded-lg bg-card text-foreground border-none hover:bg-card shadow-sm"
          aria-label="Open repository"
          title="Open repository"
          onClick={onOpenRepositoryModal}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
