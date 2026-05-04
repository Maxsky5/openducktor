import type { Theme } from "@openducktor/contracts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppCrashShell } from "./components/errors/app-crash-shell";
import { applyThemeToDocument } from "./components/layout/theme-dom";
import { appQueryClient } from "./lib/query-client";
import { configureShellBridge, type ShellBridge } from "./lib/shell-bridge";
import { loadSettingsSnapshotFromQuery } from "./state/queries/workspace";

const DEFAULT_ROOT_ID = "root";
const SETTINGS_PRELOAD_ERROR_MESSAGE = "Failed to preload settings snapshot before app bootstrap.";

export type OpenDucktorShellBootstrapOptions = {
  createShellBridge: () => ShellBridge;
  prepare?: () => void | Promise<void>;
  rootElement?: HTMLElement | null;
  rootId?: string;
};

type ShellBootstrapDependencies = {
  configureBridge: (bridge: ShellBridge) => void;
  getRootById: (rootId: string) => HTMLElement | null;
  loadSettingsSnapshot: () => Promise<{ theme: Theme }>;
  applyTheme: (theme: Theme) => void;
  renderApp: (rootElement: HTMLElement) => void;
  reportSettingsPreloadError: (error: unknown) => void;
};

const rootMissingMessage = (rootId: string): string =>
  `OpenDucktor bootstrap root element "#${rootId}" was not found. Ensure the shell HTML contains the root element.`;

const resolveRootElement = (
  options: OpenDucktorShellBootstrapOptions,
  getRootById: ShellBootstrapDependencies["getRootById"],
): HTMLElement => {
  const rootId = options.rootId ?? DEFAULT_ROOT_ID;
  const rootElement = "rootElement" in options ? options.rootElement : getRootById(rootId);

  if (!rootElement) {
    throw new Error(rootMissingMessage(rootId));
  }

  if (!(rootElement instanceof HTMLElement)) {
    throw new Error(`OpenDucktor bootstrap root element "#${rootId}" must be an HTMLElement.`);
  }

  return rootElement;
};

export const renderOpenDucktorShellApp = (rootElement: HTMLElement): void => {
  createRoot(rootElement).render(
    <StrictMode>
      <AppCrashShell>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppCrashShell>
    </StrictMode>,
  );
};

export const createOpenDucktorShellBootstrap = (dependencies: ShellBootstrapDependencies) => {
  return async (options: OpenDucktorShellBootstrapOptions): Promise<void> => {
    await options.prepare?.();

    const rootElement = resolveRootElement(options, dependencies.getRootById);
    const bridge = options.createShellBridge();
    dependencies.configureBridge(bridge);

    try {
      const settingsSnapshot = await dependencies.loadSettingsSnapshot();
      dependencies.applyTheme(settingsSnapshot.theme);
    } catch (error) {
      dependencies.reportSettingsPreloadError(error);
    }

    dependencies.renderApp(rootElement);
  };
};

export const bootstrapOpenDucktorShell = createOpenDucktorShellBootstrap({
  configureBridge: configureShellBridge,
  getRootById: (rootId) => document.getElementById(rootId),
  loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(appQueryClient),
  applyTheme: applyThemeToDocument,
  renderApp: renderOpenDucktorShellApp,
  reportSettingsPreloadError: (error) => {
    console.error(SETTINGS_PRELOAD_ERROR_MESSAGE, error);
  },
});
