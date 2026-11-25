import type { ComponentType } from "react";

type PageModule = {
  default: ComponentType;
};

type PageLoader = () => Promise<PageModule>;

/** The page component of each loader that finished, so a route can render it without a wait. */
const loadedPages = new WeakMap<PageLoader, ComponentType>();

export const createCachedPageLoader = (loadPage: PageLoader): PageLoader => {
  let cachedPageLoad: Promise<PageModule> | null = null;

  const load: PageLoader = () => {
    cachedPageLoad ??= loadPage()
      .then((module) => {
        loadedPages.set(load, module.default);
        return module;
      })
      .catch((error) => {
        cachedPageLoad = null;
        throw error;
      });

    return cachedPageLoad;
  };
  return load;
};

/**
 * The page of a loader that finished, or undefined. A lazy page suspends on its first render even
 * when its code is ready, and React then keeps the fallback for at least 300 ms. A loaded page can
 * render directly instead.
 */
export const loadedPage = (load: PageLoader): ComponentType | undefined => loadedPages.get(load);

const reportRoutePreloadError = (pageName: string, cause: unknown): void => {
  console.error(`[route-preload] Failed to preload ${pageName} page.`, cause);
};

const preloadRoutePage = (pageName: string, loadPage: PageLoader): void => {
  void loadPage().catch((error) => reportRoutePreloadError(pageName, error));
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
// The canvas library loads only with the editor.
export const loadWorkflowEditorPage = createCachedPageLoader(() =>
  import("./workflows/workflow-editor-page").then((module) => ({
    default: module.WorkflowEditorPage,
  })),
);

/** Loads the editor code before the user opens a workflow, so the first open shows at once. */
export const preloadWorkflowEditorPage = (): void => {
  preloadRoutePage("Workflow editor", loadWorkflowEditorPage);
};
