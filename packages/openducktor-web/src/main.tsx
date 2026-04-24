import { configureShellBridge, mountOpenDucktorApp } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

configureShellBridge(createBrowserShellBridge());

void mountOpenDucktorApp(rootElement);
