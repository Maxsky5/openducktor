import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { applyThemeToDocument } from "@/components/layout/theme-dom";
import { appQueryClient } from "@/lib/query-client";
import { loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const renderApp = (): void => {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
};

const bootstrap = async (): Promise<void> => {
  try {
    const settingsSnapshot = await loadSettingsSnapshotFromQuery(appQueryClient);
    applyThemeToDocument(settingsSnapshot.theme);
  } catch (error) {
    console.error("Failed to preload settings snapshot before app bootstrap.", error);
  } finally {
    renderApp();
  }
};

void bootstrap();
