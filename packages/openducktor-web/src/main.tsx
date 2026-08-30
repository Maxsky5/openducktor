import { bootstrapOpenDucktorShell, showOpenDucktorStartupFailure } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { loadBrowserRuntimeConfig } from "./runtime-config";

bootstrapOpenDucktorShell({
  prepare: loadBrowserRuntimeConfig,
  createShellBridge: createBrowserShellBridge,
}).catch((cause: unknown) => {
  showOpenDucktorStartupFailure();
  console.error("Critical browser bootstrap failure", cause);
});
