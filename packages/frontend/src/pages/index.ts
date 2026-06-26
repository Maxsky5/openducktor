import type { ComponentType } from "react";

type PageModule = {
  default: ComponentType;
};

type PageLoader = () => Promise<PageModule>;

export const createCachedPageLoader = (loadPage: PageLoader): PageLoader => {
  let cachedPageLoad: Promise<PageModule> | null = null;

  return () => {
    cachedPageLoad ??= loadPage().catch((error) => {
      cachedPageLoad = null;
      throw error;
    });

    return cachedPageLoad;
  };
};

const reportRoutePreloadError = (pageName: string, error: unknown): void => {
  console.error(`[route-preload] Failed to preload ${pageName} page.`, error);
};

const preloadRoutePage = (pageName: string, loadPage: PageLoader): void => {
  void loadPage().catch((error) => reportRoutePreloadError(pageName, error));
};

export const loadAgentsPage = createCachedPageLoader(() =>
  import("./agents/agents-page").then((module) => ({
    default: module.AgentsPage,
  })),
);

export const preloadAgentsPage = (): void => {
  preloadRoutePage("Agent Studio", loadAgentsPage);
};

export const loadKanbanPage = createCachedPageLoader(() =>
  import("./kanban/kanban-page").then((module) => ({
    default: module.KanbanPage,
  })),
);

export const preloadKanbanPage = (): void => {
  preloadRoutePage("Kanban", loadKanbanPage);
};

export const loadNotFoundPage = createCachedPageLoader(() =>
  import("./not-found-page").then((module) => ({
    default: module.NotFoundPage,
  })),
);

export const preloadNotFoundPage = (): void => {
  preloadRoutePage("Not Found", loadNotFoundPage);
};
