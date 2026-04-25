import { configureShellBridge, mountOpenDucktorApp } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { loadBrowserRuntimeConfig } from "./runtime-config";

const bootstrap = async (): Promise<void> => {
  await loadBrowserRuntimeConfig();

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  configureShellBridge(createBrowserShellBridge());

  await mountOpenDucktorApp(rootElement);
};

void bootstrap();
