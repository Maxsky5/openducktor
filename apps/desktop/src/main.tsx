import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createDesktopShellBridge } from "./desktop-shell-bridge";

bootstrapOpenDucktorShell({
  createShellBridge: createDesktopShellBridge,
}).catch((error: unknown) => {
  console.error("Critical desktop bootstrap failure", error);
});
