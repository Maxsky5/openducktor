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
  onToggleCollapse: () => void;
  className?: string;
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
  onToggleCollapse,
  className,
}: AgentSessionTodoPanelProps): ReactElement | null {
  const visibleTodos = todos.filter((todo) => todo.status !== "cancelled");
  if (visibleTodos.length === 0) {
    return null;
  }

  const actionableTodo =
    visibleTodos.find((todo) => todo.status === "in_progress") ??
    visibleTodos.find((todo) => todo.status === "pending") ??
    null;
  if (!actionableTodo) {
    return null;
  }
  const completedCount = visibleTodos.filter((todo) => todo.status === "completed").length;
  const toggleLabel = collapsed ? "Expand todo list" : "Collapse todo list";

  return (
    <section
      className={cn("w-full rounded-xl border border-input bg-card shadow-sm", className)}
      aria-label="Agent todo list"
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
        onClick={onToggleCollapse}
        aria-label={toggleLabel}
      >
        <ListTodo className="size-4 shrink-0 text-muted-foreground" />
        <p className="text-[13px] font-semibold text-foreground">Todo</p>
        <p className="text-[11px] font-medium text-muted-foreground">
          {completedCount}/{visibleTodos.length}
        </p>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {collapsed ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
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
        <div className="border-t border-input px-3 pb-3 pt-2">
          <ul className="max-h-[40vh] space-y-1 overflow-y-auto overscroll-contain pr-1">
            {visibleTodos.map((todo) => (
              <li key={todo.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm">
                <span className="inline-flex size-5 shrink-0 items-center justify-center">
                  {statusIcon(todo.status, isSessionWorking)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 leading-5 text-foreground",
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
