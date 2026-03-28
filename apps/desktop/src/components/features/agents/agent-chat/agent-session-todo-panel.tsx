import type { AgentSessionTodoItem } from "@openducktor/core";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDotDashed,
  ListTodo,
  LoaderCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type AgentSessionTodoPanelProps = {
  todos: AgentSessionTodoItem[];
  collapsed: boolean;
  isSessionWorking: boolean;
  accentColor?: string | undefined;
  onToggleCollapse: () => void;
  className?: string;
};

export const getVisibleSessionTodos = (todos: AgentSessionTodoItem[]): AgentSessionTodoItem[] => {
  return todos.filter((todo) => todo.status !== "cancelled");
};

export const getActionableSessionTodo = (
  todos: AgentSessionTodoItem[],
): AgentSessionTodoItem | null => {
  return (
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    null
  );
};

const statusIcon = (
  status: AgentSessionTodoItem["status"],
  isSessionWorking: boolean,
): ReactElement => {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 text-success-accent" />;
  }
  if (status === "in_progress") {
    return isSessionWorking ? (
      <LoaderCircle className="size-3.5 animate-spin text-primary" />
    ) : (
      <CircleDotDashed className="size-3.5 text-primary" />
    );
  }
  return <Circle className="size-3.5 text-muted-foreground" />;
};

export function AgentSessionTodoPanel({
  todos,
  collapsed,
  isSessionWorking,
  accentColor,
  onToggleCollapse,
  className,
}: AgentSessionTodoPanelProps): ReactElement | null {
  const visibleTodos = getVisibleSessionTodos(todos);
  if (visibleTodos.length === 0) {
    return null;
  }

  const actionableTodo = getActionableSessionTodo(visibleTodos);
  if (!actionableTodo) {
    return null;
  }
  const completedCount = visibleTodos.filter((todo) => todo.status === "completed").length;
  const toggleLabel = collapsed ? "Expand todo list" : "Collapse todo list";

  return (
    <section
      className={cn(
        "w-full rounded-t-xl border border-input border-b-0 border-l-4 bg-card",
        className,
      )}
      aria-label="Agent todo list"
      style={accentColor ? { borderLeftColor: accentColor } : undefined}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-muted/70"
        onClick={onToggleCollapse}
        aria-label={toggleLabel}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <ListTodo className="size-4 shrink-0 text-muted-foreground" />
            <p className="text-[13px] font-semibold text-foreground">Todo</p>
            <p className="text-[11px] font-medium text-muted-foreground">
              {completedCount}/{visibleTodos.length}
            </p>
          </div>
          {collapsed ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-border/70 pl-3 text-sm text-foreground">
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                {statusIcon(actionableTodo.status, isSessionWorking)}
              </span>
              <span className="truncate">{actionableTodo.content}</span>
            </div>
          ) : null}
          {collapsed ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          )}
        </div>
      </button>

      {collapsed ? null : (
        <div className="border-t border-input/80 px-3 pb-3 pt-2">
          <ul className="max-h-[40vh] space-y-1 overflow-y-auto overscroll-contain pr-1">
            {visibleTodos.map((todo) => (
              <li
                key={todo.id}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2 rounded-md px-1 py-1 text-sm"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  {statusIcon(todo.status, isSessionWorking)}
                </span>
                <span
                  className={cn(
                    "block min-w-0 leading-5 text-foreground",
                    todo.status === "in_progress" && "font-medium text-foreground",
                    todo.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {todo.content}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
