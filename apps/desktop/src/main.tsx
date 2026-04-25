import { configureShellBridge, mountOpenDucktorApp } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createDesktopShellBridge } from "./desktop-shell-bridge";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

configureShellBridge(createDesktopShellBridge());

void mountOpenDucktorApp(rootElement);
