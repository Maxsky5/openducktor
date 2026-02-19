import { cn } from "@/lib/utils";
import type { AgentSessionTodoItem } from "@openblueprint/core";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, ListTodo, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";

type AgentSessionTodoPanelProps = {
  todos: AgentSessionTodoItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
};

const STATUS_ORDER: Record<AgentSessionTodoItem["status"], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

const statusIcon = (status: AgentSessionTodoItem["status"]): ReactElement => {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  }
  if (status === "in_progress") {
    return <LoaderCircle className="size-3.5 animate-spin text-sky-600" />;
  }
  return <Circle className="size-3.5 text-slate-500" />;
};

export function AgentSessionTodoPanel({
  todos,
  collapsed,
  onToggleCollapse,
  className,
}: AgentSessionTodoPanelProps): ReactElement | null {
  const visibleTodos = [...todos]
    .filter((todo) => todo.status !== "cancelled")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  if (visibleTodos.length === 0) {
    return null;
  }

  const hasActiveTodos = visibleTodos.some(
    (todo) => todo.status === "in_progress" || todo.status === "pending",
  );
  if (!hasActiveTodos) {
    return null;
  }

  const activeTodo =
    visibleTodos.find((todo) => todo.status === "in_progress") ??
    visibleTodos.find((todo) => todo.status === "pending") ??
    visibleTodos[0];
  if (!activeTodo) {
    return null;
  }
  const completedCount = visibleTodos.filter((todo) => todo.status === "completed").length;

  return (
    <section
      className={cn(
        "w-full max-w-md rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur-sm",
        className,
      )}
      aria-label="Agent todo list"
    >
      <div className="flex items-center gap-2">
        <ListTodo className="size-3.5 text-slate-600" />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Todo</p>
        <p className="ml-auto text-xs text-slate-500">
          {completedCount}/{visibleTodos.length}
        </p>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand todo list" : "Collapse todo list"}
        >
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {collapsed ? (
        <div className="mt-2 flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
          {statusIcon(activeTodo.status)}
          <p className="line-clamp-2">{activeTodo.content}</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {visibleTodos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 rounded px-1 py-1 text-sm">
              {statusIcon(todo.status)}
              <span
                className={cn(
                  "leading-5 text-slate-700",
                  todo.status === "completed" && "text-slate-500 line-through",
                )}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
