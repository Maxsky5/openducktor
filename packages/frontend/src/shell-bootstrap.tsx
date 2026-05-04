import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
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

export type { OpenDucktorShellBootstrapOptions };

const renderOpenDucktorShellApp = (rootElement: HTMLElement): void => {
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

export const bootstrapOpenDucktorShell = (
  options: OpenDucktorShellBootstrapOptions,
): Promise<void> =>
  runOpenDucktorShellBootstrap(options, {
    configureBridge: configureShellBridge,
    getRootById: (rootId) => document.getElementById(rootId),
    loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(appQueryClient),
    applyTheme: applyThemeToDocument,
    renderApp: renderOpenDucktorShellApp,
    reportSettingsPreloadError: (error) => {
      console.error(SETTINGS_PRELOAD_ERROR_MESSAGE, error);
    },
  });
