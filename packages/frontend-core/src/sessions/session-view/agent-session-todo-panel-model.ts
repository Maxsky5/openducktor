import type { AgentSessionTodoItem } from "@openducktor/core";

export const getVisibleSessionTodos = (
  todos: readonly AgentSessionTodoItem[],
): AgentSessionTodoItem[] => {
  return todos.filter((todo) => todo.status !== "cancelled");
};

export const getActionableSessionTodo = (
  todos: readonly AgentSessionTodoItem[],
): AgentSessionTodoItem | null => {
  return (
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    null
  );
};
