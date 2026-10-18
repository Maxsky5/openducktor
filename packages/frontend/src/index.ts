export type {
  AzureDevOpsConnectionUpdateListener,
  HostConnection,
  RunEventListener,
} from "@openducktor/frontend-core/connection/host-connection";
export type { NotificationBridge } from "@openducktor/frontend-core/platform/notification-bridge";
export {
  type AppUpdateBridge,
  createDisabledAppUpdateBridge,
  type ShellBridge,
  type ShellCapabilities,
  type TerminalBridge,
  type TerminalTransportConnection,
  type TerminalTransportState,
} from "./lib/shell-bridge";
export {
  bootstrapOpenDucktorShell,
  type OpenDucktorShellBootstrapOptions,
} from "./shell-bootstrap";
export { showOpenDucktorStartupFailure } from "./startup-splash/runtime";
