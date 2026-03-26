import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolveTaskCardActions, type TaskWorkflowAction } from "./kanban-task-workflow";
import {
  TASK_ACTION_ICON,
  taskActionIsDestructive,
  taskActionLabel,
  taskPrimaryActionVariant,
} from "./task-action-ui";

const EMPTY_EXTRA_MENU_ACTIONS: readonly ExtraTaskMenuAction[] = [];
const DESTRUCTIVE_MENU_ITEM_CLASS_NAME =
  "text-destructive-muted hover:border-destructive-border/60 hover:bg-destructive-surface/70 hover:text-destructive-surface-foreground dark:hover:bg-destructive-surface/55";

type ExtraTaskMenuAction = {
  id: string;
  label: string;
  icon: ReactElement;
  onSelect: () => void;
  destructive?: boolean;
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
};

export function TaskWorkflowActionGroup({
  task,
  onAction,
  includeActions,
  hasActiveSession = false,
  activeSessionRole,
  historicalSessionRoles,
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
}: TaskWorkflowActionGroupProps): ReactElement | null {
  const [isMenuOpen, setMenuOpen] = useState(false);
  const resolveActionOptions = {
    hasActiveSession,
    ...(activeSessionRole ? { activeSessionRole } : {}),
    ...(historicalSessionRoles ? { historicalSessionRoles } : {}),
  };
  const { primaryAction, secondaryActions, allActions } = includeActions
    ? resolveTaskCardActions(task, { include: includeActions, ...resolveActionOptions })
    : resolveTaskCardActions(task, resolveActionOptions);
  const hasWorkflowAction = allActions.length > 0;
  const hasExtraMenuAction = extraMenuActions.length > 0;
  const hasAnyAction = hasWorkflowAction || hasExtraMenuAction;

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

  const primary = primaryAction ?? allActions[0] ?? null;
  const showMenu = secondaryActions.length > 0 || hasExtraMenuAction;
  const actionItems = showMenu ? secondaryActions : [];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {primary ? (
        <Button
          type="button"
          size={size}
          variant={taskPrimaryActionVariant(primary)}
          className={cn(expandPrimary ? "min-w-0 flex-1" : "", primaryClassName)}
          onClick={() => onAction(primary)}
        >
          {primaryContent ?? (
            <>
              {TASK_ACTION_ICON[primary]}
              {taskActionLabel(primary, task)}
            </>
          )}
        </Button>
      ) : null}

      {showMenu ? (
        <Popover open={isMenuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size={size}
              variant="outline"
              className={cn(
                compactMenuTrigger ? "px-2.5" : "px-3",
                expandPrimary ? "shrink-0" : "",
                "h-9",
              )}
            >
              {compactMenuTrigger ? null : <MoreHorizontal className="size-3.5" />}
              {!compactMenuTrigger ? "More" : null}
              <ChevronDown className="size-3.5 opacity-80" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align={menuAlign} className="w-56 p-1.5">
            <div className="space-y-1">
              {actionItems.map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 w-full justify-start border border-transparent",
                    taskActionIsDestructive(action) ? DESTRUCTIVE_MENU_ITEM_CLASS_NAME : "",
                  )}
                  onClick={() => {
                    onAction(action);
                    setMenuOpen(false);
                  }}
                >
                  {TASK_ACTION_ICON[action]}
                  {taskActionLabel(action, task)}
                </Button>
              ))}
              {actionItems.length > 0 && hasExtraMenuAction ? (
                <div className="my-1 border-t border-border" />
              ) : null}
              {extraMenuActions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 w-full justify-start border border-transparent",
                    action.destructive ? DESTRUCTIVE_MENU_ITEM_CLASS_NAME : "",
                  )}
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
      ) : null}
    </div>
  );
}
