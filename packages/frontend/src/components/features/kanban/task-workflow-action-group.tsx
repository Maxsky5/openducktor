import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
  taskActionLabel,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CoreTaskAction } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";
import {
  coreTaskActionIcon,
  coreTaskActionPrimaryVariant,
  taskActionIcon,
  taskMenuActionVariant,
  taskPrimaryActionVariant,
} from "./task-action-ui";

const EMPTY_EXTRA_MENU_ACTIONS: readonly ExtraTaskMenuAction[] = [];
const EMPTY_DISABLED_ACTIONS: readonly TaskWorkflowAction[] = [];

type ExtraTaskMenuAction = {
  id: string;
  label: string;
  icon: ReactElement;
  onSelect: () => void;
  variant?: "ghost" | "destructiveGhost" | "warningGhost";
  disabled?: boolean;
};

type TaskWorkflowActionGroupProps = {
  task: TaskCard;
  onAction: (action: TaskWorkflowAction) => void;
  includeActions?: readonly TaskWorkflowAction[];
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  historicalSessionRoles?: readonly AgentRole[];
  extraMenuActions?: readonly ExtraTaskMenuAction[];
  menuAlign?: "start" | "center" | "end";
  className?: string;
  primaryClassName?: string;
  primaryContent?: ReactNode;
  size?: "default" | "sm";
  expandPrimary?: boolean;
  compactMenuTrigger?: boolean;
  emptyLabel?: string;
  hideWhenEmpty?: boolean;
  actions?: ReturnType<typeof resolveTaskCardActions>;
  disabledActions?: readonly TaskWorkflowAction[];
  /** A core task action that replaces the primary workflow action, such as Close Task when merged. */
  leadingCoreAction?: { action: CoreTaskAction; onSelect: () => void } | undefined;
};

export function TaskWorkflowActionGroup(props: TaskWorkflowActionGroupProps): ReactElement | null {
  const {
    task,
    onAction,
    extraMenuActions = EMPTY_EXTRA_MENU_ACTIONS,
    menuAlign = "end",
    className,
    primaryClassName,
    primaryContent,
    size = "default",
    expandPrimary = false,
    compactMenuTrigger = false,
    emptyLabel = "No workflow action",
    hideWhenEmpty = false,
    actions,
    disabledActions = EMPTY_DISABLED_ACTIONS,
    leadingCoreAction,
  } = props;
  const { primaryAction, secondaryActions, allActions } = getActions(props);
  const hasWorkflowAction = allActions.length > 0 || leadingCoreAction !== undefined;
  const hasExtraMenuAction = extraMenuActions.length > 0;
  const hasAnyAction = hasWorkflowAction || hasExtraMenuAction;
  const showMenu = secondaryActions.length > 0 || hasExtraMenuAction;

  if (!hasAnyAction) {
    if (hideWhenEmpty) {
      return null;
    }

    return (
      <Button
        type="button"
        size={size}
        variant="outline"
        className={cn("w-full", className)}
        disabled
      >
        {emptyLabel}
      </Button>
    );
  }

  const primary = leadingCoreAction ? null : (primaryAction ?? allActions[0] ?? null);
  const buttonProps = {
    size,
    className: cn(expandPrimary ? "min-w-0 flex-1" : "", primaryClassName),
    isKanbanCard: actions !== undefined,
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {leadingCoreAction ? (
        <PrimaryActionButton
          {...buttonProps}
          variant={coreTaskActionPrimaryVariant(leadingCoreAction.action)}
          onSelect={leadingCoreAction.onSelect}
        >
          {coreTaskActionIcon(leadingCoreAction.action)}
          {leadingCoreAction.action.label}
        </PrimaryActionButton>
      ) : null}
      {primary ? (
        <PrimaryActionButton
          {...buttonProps}
          variant={taskPrimaryActionVariant(primary, task)}
          disabled={disabledActions.includes(primary)}
          onSelect={() => onAction(primary)}
        >
          {primaryContent ?? (
            <>
              {taskActionIcon(primary, task)}
              {taskActionLabel(primary, task)}
            </>
          )}
        </PrimaryActionButton>
      ) : null}

      {showMenu ? (
        <TaskWorkflowActionMenu
          task={task}
          onAction={onAction}
          actionItems={secondaryActions}
          extraMenuActions={extraMenuActions}
          disabledActions={new Set(disabledActions)}
          isKanbanCard={actions !== undefined}
          menuAlign={menuAlign}
          size={size}
          expandPrimary={expandPrimary}
          compactMenuTrigger={compactMenuTrigger}
        />
      ) : null}
    </div>
  );
}

function PrimaryActionButton({
  size,
  variant,
  className,
  isKanbanCard,
  disabled,
  onSelect,
  children,
}: {
  size: "default" | "sm";
  variant: "default" | "outline" | "destructive" | "warning";
  className: string;
  isKanbanCard: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      data-kanban-control={isKanbanCard ? "primary" : undefined}
      disabled={disabled}
      onClick={(event) => {
        if (isKanbanCard) event.stopPropagation();
        onSelect();
      }}
    >
      {children}
    </Button>
  );
}

const getActions = ({
  task,
  actions,
  includeActions,
  hasActiveSession = false,
  activeSessionRole,
  historicalSessionRoles,
}: TaskWorkflowActionGroupProps): ReturnType<typeof resolveTaskCardActions> => {
  if (actions) return actions;
  return resolveTaskCardActions(task, {
    hasActiveSession,
    surface: "details",
    include: includeActions,
    activeSessionRole,
    historicalSessionRoles,
  });
};

type TaskWorkflowActionMenuProps = Required<
  Pick<
    TaskWorkflowActionGroupProps,
    | "task"
    | "onAction"
    | "extraMenuActions"
    | "menuAlign"
    | "size"
    | "expandPrimary"
    | "compactMenuTrigger"
  >
> & {
  actionItems: readonly TaskWorkflowAction[];
  disabledActions: ReadonlySet<TaskWorkflowAction>;
  isKanbanCard: boolean;
};

function TaskWorkflowActionMenu({
  task,
  onAction,
  actionItems,
  extraMenuActions,
  disabledActions,
  isKanbanCard,
  menuAlign,
  size,
  expandPrimary,
  compactMenuTrigger,
}: TaskWorkflowActionMenuProps): ReactElement {
  const [isMenuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuContentRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open={isMenuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          ref={menuTriggerRef}
          onClick={isKanbanCard ? (event) => event.stopPropagation() : undefined}
          data-kanban-control={isKanbanCard ? "menu" : undefined}
          aria-label={compactMenuTrigger ? "Open workflow actions menu" : undefined}
          size={size}
          variant="outline"
          className={cn(
            compactMenuTrigger ? "px-2.5" : "px-3",
            expandPrimary ? "shrink-0" : "",
            "h-9 shadow-sm",
          )}
        >
          {compactMenuTrigger ? null : <MoreHorizontal className="size-3.5" />}
          {!compactMenuTrigger ? "More" : null}
          <ChevronDown className="size-3.5 opacity-80" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={menuContentRef}
        align={menuAlign}
        className="w-56 p-1.5"
        data-kanban-task-id={isKanbanCard ? task.id : undefined}
        onCloseAutoFocus={
          isKanbanCard
            ? (event) => {
                event.preventDefault();
                // An action can move focus to a dialog or another view before the menu closes.
                const activeElement = document.activeElement;
                if (
                  activeElement === document.body ||
                  menuContentRef.current?.contains(activeElement)
                ) {
                  menuTriggerRef.current?.focus();
                }
              }
            : undefined
        }
      >
        <div className="flex flex-col gap-1">
          {actionItems.map((action) => (
            <Button
              key={action}
              type="button"
              variant={taskMenuActionVariant(action, task)}
              size="sm"
              className="h-8 w-full justify-start border border-transparent"
              data-kanban-control={isKanbanCard ? "menu" : undefined}
              disabled={disabledActions.has(action)}
              onClick={(event) => {
                if (isKanbanCard) event.stopPropagation();
                onAction(action);
                setMenuOpen(false);
              }}
            >
              {taskActionIcon(action, task)}
              {taskActionLabel(action, task)}
            </Button>
          ))}
          {actionItems.length > 0 && extraMenuActions.length > 0 ? (
            <div className="my-1 border-t border-border" />
          ) : null}
          {extraMenuActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant={action.variant ?? "ghost"}
              size="sm"
              className="h-8 w-full justify-start border border-transparent"
              disabled={action.disabled}
              onClick={() => {
                action.onSelect();
                setMenuOpen(false);
              }}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
