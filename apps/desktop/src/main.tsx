import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createDesktopShellBridge } from "./desktop-shell-bridge";

void bootstrapOpenDucktorShell({
  createShellBridge: createDesktopShellBridge,
});
