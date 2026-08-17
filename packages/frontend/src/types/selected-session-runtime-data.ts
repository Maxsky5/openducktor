import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";

export type SelectedSessionRuntimeData = {
  modelCatalog: AgentModelCatalog | null;
  todos: AgentSessionTodoItem[];
  isLoadingModelCatalog: boolean;
  catalogError: string | null;
  todosError: string | null;
  runtimePolicyError: string | null;
  contextError: string | null;
};

export const EMPTY_SELECTED_SESSION_RUNTIME_DATA: SelectedSessionRuntimeData = Object.freeze({
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  catalogError: null,
  todosError: null,
  runtimePolicyError: null,
  contextError: null,
});
