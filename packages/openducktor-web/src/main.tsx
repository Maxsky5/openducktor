import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { loadBrowserRuntimeConfig } from "./runtime-config";

void bootstrapOpenDucktorShell({
  prepare: loadBrowserRuntimeConfig,
  createShellBridge: createBrowserShellBridge,
});
