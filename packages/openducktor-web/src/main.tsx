import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { loadBrowserRuntimeConfig } from "./runtime-config";

bootstrapOpenDucktorShell({
  prepare: loadBrowserRuntimeConfig,
  createShellBridge: createBrowserShellBridge,
}).catch((error: unknown) => {
  console.error("Critical browser bootstrap failure", error);
});
