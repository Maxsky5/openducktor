import type { ComponentType } from "react";

type PageModule = {
  default: ComponentType;
};

let agentsPageLoad: Promise<PageModule> | null = null;
let kanbanPageLoad: Promise<PageModule> | null = null;
let notFoundPageLoad: Promise<PageModule> | null = null;

const reportRoutePreloadError = (pageName: string, error: unknown): void => {
  console.error(`[route-preload] Failed to preload ${pageName} page.`, error);
};

const preloadRoutePage = (pageName: string, loadPage: () => Promise<PageModule>): void => {
  void loadPage().catch((error) => reportRoutePreloadError(pageName, error));
};

export const loadAgentsPage = (): Promise<PageModule> => {
  agentsPageLoad ??= import("./agents/agents-page").then((module) => ({
    default: module.AgentsPage,
  }));

  return agentsPageLoad;
};

export const preloadAgentsPage = (): void => {
  preloadRoutePage("Agent Studio", loadAgentsPage);
};

export const loadKanbanPage = (): Promise<PageModule> => {
  kanbanPageLoad ??= import("./kanban/kanban-page").then((module) => ({
    default: module.KanbanPage,
  }));

  return kanbanPageLoad;
};

export const preloadKanbanPage = (): void => {
  preloadRoutePage("Kanban", loadKanbanPage);
};

export const loadNotFoundPage = (): Promise<PageModule> => {
  notFoundPageLoad ??= import("./not-found-page").then((module) => ({
    default: module.NotFoundPage,
  }));

  return notFoundPageLoad;
};
