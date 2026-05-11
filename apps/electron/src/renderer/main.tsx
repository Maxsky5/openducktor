import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createElectronShellBridge } from "./electron-shell-bridge";

bootstrapOpenDucktorShell({
  createShellBridge: createElectronShellBridge,
}).catch((error: unknown) => {
  console.error("Critical Electron bootstrap failure", error);
});
