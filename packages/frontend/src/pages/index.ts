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

export const loadNotFoundPage = createCachedPageLoader(() =>
  import("./not-found-page").then((module) => ({
    default: module.NotFoundPage,
  })),
);
