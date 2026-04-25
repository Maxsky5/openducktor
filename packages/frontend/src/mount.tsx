import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppCrashShell } from "./components/errors/app-crash-shell";
import { applyThemeToDocument } from "./components/layout/theme-dom";
import { appQueryClient } from "./lib/query-client";
import { loadSettingsSnapshotFromQuery } from "./state/queries/workspace";

const renderApp = (rootElement: HTMLElement): void => {
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

export const mountOpenDucktorApp = async (rootElement: HTMLElement): Promise<void> => {
  try {
    const settingsSnapshot = await loadSettingsSnapshotFromQuery(appQueryClient);
    applyThemeToDocument(settingsSnapshot.theme);
  } catch (error) {
    console.error("Failed to preload settings snapshot before app bootstrap.", error);
  } finally {
    renderApp(rootElement);
  }
};
