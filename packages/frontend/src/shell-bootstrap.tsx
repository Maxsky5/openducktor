import type { ComponentType, ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { AppCrashShell } from "./components/errors/app-crash-shell";
import { applyThemeToDocument } from "./components/layout/theme-dom";
import { appQueryClient } from "./lib/query-client";
import { configureShellBridge } from "./lib/shell-bridge";
import {
  type OpenDucktorShellBootstrapOptions,
  runOpenDucktorShellBootstrap,
} from "./shell-bootstrap-workflow";
import { loadSettingsSnapshotFromQuery } from "./state/queries/workspace";

const SETTINGS_PRELOAD_ERROR_MESSAGE = "Failed to preload settings snapshot before app bootstrap.";
const DEFAULT_ROUTER_MODE = "browser";

export type { OpenDucktorShellBootstrapOptions };

type ShellRouterMode = NonNullable<OpenDucktorShellBootstrapOptions["routerMode"]>;
type ShellRouterComponent = ComponentType<{ children?: ReactNode }>;

const ROUTERS: Record<ShellRouterMode, ShellRouterComponent> = {
  browser: BrowserRouter,
  hash: HashRouter,
};

const kanbanLocationForRouter = (routerMode: ShellRouterMode): string =>
  routerMode === "hash" ? "#/kanban" : "/kanban";

const renderOpenDucktorShellApp = (rootElement: HTMLElement, routerMode: ShellRouterMode): void => {
  const Router = ROUTERS[routerMode];

  createRoot(rootElement).render(
    <StrictMode>
      <Router>
        <AppCrashShell kanbanLocation={kanbanLocationForRouter(routerMode)}>
          <App />
        </AppCrashShell>
      </Router>
    </StrictMode>,
  );
};

export const bootstrapOpenDucktorShell = (
  options: OpenDucktorShellBootstrapOptions,
): Promise<void> =>
  runOpenDucktorShellBootstrap(options, {
    configureBridge: configureShellBridge,
    getRootById: (rootId) => document.getElementById(rootId),
    loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(appQueryClient),
    applyTheme: applyThemeToDocument,
    renderApp: (rootElement) =>
      renderOpenDucktorShellApp(rootElement, options.routerMode ?? DEFAULT_ROUTER_MODE),
    reportSettingsPreloadError: (error) => {
      console.error(SETTINGS_PRELOAD_ERROR_MESSAGE, error);
    },
  });
