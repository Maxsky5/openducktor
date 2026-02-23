export const loadAgentsPage = async () => {
  const module = await import("./agents-page");
  return { default: module.AgentsPage };
};

export const loadKanbanPage = async () => {
  const module = await import("./kanban-page");
  return { default: module.KanbanPage };
};

export const loadNotFoundPage = async () => {
  const module = await import("./not-found-page");
  return { default: module.NotFoundPage };
};
