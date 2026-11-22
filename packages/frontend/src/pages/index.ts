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

/** The route of the Usage page. */
export const USAGE_PATH = "/usage";

export const loadUsagePage = createCachedPageLoader(() =>
  import("./usage/usage-page").then((module) => ({
    default: module.UsagePage,
  })),
);
