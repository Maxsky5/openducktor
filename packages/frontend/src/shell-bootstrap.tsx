import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { loadSettingsSnapshotFromQuery } from "@openducktor/frontend-core/queries/workspace";
import { App } from "./App";
import { AppCrashShell } from "./components/errors/app-crash-shell";
import { applyThemeToDocument } from "./components/layout/theme-dom";
import { readSystemAppearance, resolveThemePreference } from "./components/layout/theme-preference";
import { watchClientPage } from "./lib/client-page";
import { createShellConnection, releaseShellConnection } from "./lib/shell-connection";
import { configureShellBridge, type ShellBridge } from "./lib/shell-bridge";
import {
  type OpenDucktorShellBootstrapOptions,
  resolveRootElement,
} from "./shell-bootstrap-workflow";
import { dismissOpenDucktorStartupSplash } from "./startup-splash/runtime";
import { ShellStateProvider } from "./state/app-state-provider";
import { HostConnectionProvider } from "./components/layout/host-connection";
import { HostConnectionPage } from "./components/layout/host-connection-page";
import { HostPicker } from "./components/layout/host-picker";
import {
  hostLocation,
  readHostTarget,
  sameHostTarget,
  saveHostTarget,
  type HostSelection,
  type HostTarget,
} from "./lib/host-location";
import { parseRemoteHostEndpoint } from "@openducktor/frontend-core/recovery/remote-host-endpoint";

const SETTINGS_PRELOAD_ERROR_MESSAGE = "Failed to preload settings snapshot before app bootstrap.";
const DEFAULT_ROUTER_MODE = "browser";

export type { OpenDucktorShellBootstrapOptions };

type ShellRouterMode = NonNullable<OpenDucktorShellBootstrapOptions["routerMode"]>;

const kanbanLocationForRouter = (routerMode: ShellRouterMode): string =>
  routerMode === "hash" ? "#/kanban" : "/kanban";

const StartupSplashLifecycle = (): null => {
  useEffect(() => {
    dismissOpenDucktorStartupSplash();
  }, []);

  return null;
};

export async function bootstrapOpenDucktorShell(
  options: OpenDucktorShellBootstrapOptions,
): Promise<void> {
  const { hosts } = options;
  await options.prepare?.();
  const element = resolveRootElement(options, (id) => document.getElementById(id));
  const root = createRoot(element);
  const location = new URL(window.location.href);
  const localAvailable = hosts.localHost !== null;
  let target: HostTarget;
  let error: string | undefined;
  try {
    target = readHostTarget(location, localAvailable, hosts.defaultEndpoint);
  } catch (cause) {
    target = { kind: "picker" };
    error = cause instanceof Error ? cause.message : String(cause);
  }
  let leavePage: () => Promise<void>;
  let saveDrafts = (): Promise<void> => Promise.resolve();
  const watchPage = (bridge?: ShellBridge) =>
    watchClientPage(bridge, () => {
      try {
        return !sameHostTarget(
          target,
          readHostTarget(location, localAvailable, hosts.defaultEndpoint),
        );
      } catch {
        // Startup shows the saved-host error. A cached document must return through that check.
        return true;
      }
    });
  const move = async (next: HostTarget) => {
    if (sameHostTarget(target, next)) return;
    // A local draft that cannot be saved keeps this page, so the user sees why and keeps the draft.
    await saveDrafts();
    saveHostTarget(next, location.protocol);
    const url = hostLocation(location, next);
    // The release unmounts the app first. A release failure leaves no view to keep, so the reload
    // still runs.
    await leavePage().catch((cause: unknown) => {
      console.error("Could not release the host client.", cause);
    });
    window.history.replaceState(null, "", url);
    if (hosts.navigate) await hosts.navigate();
    else window.location.reload();
  };
  const selection: HostSelection = {
    target,
    localHost: hosts.localHost,
    select: async (endpoint) => {
      if (endpoint === null && !localAvailable) throw new Error("This client has no local host.");
      await move(
        endpoint === null
          ? { kind: "local" }
          : {
              kind: "remote",
              endpoint: parseRemoteHostEndpoint(endpoint, {
                requireHttps: location.protocol === "https:",
              }),
            },
      );
    },
    disconnect: () => move({ kind: "picker" }),
  };
  applyThemeToDocument(resolveThemePreference("system", readSystemAppearance()));
  if (target.kind === "picker") {
    leavePage = watchPage();
    root.render(
      <StrictMode>
        <StartupSplashLifecycle />
        <HostConnectionPage
          title="Connect to a host"
          description="Open your host's workspaces and agents in this browser."
        >
          <HostPicker selection={selection} error={error} />
        </HostConnectionPage>
      </StrictMode>,
    );
    return;
  }
  const queryClient = createClientQueryClient();
  const local = localAvailable ? options.createShellBridge() : undefined;
  let bridge: ShellBridge | undefined;
  if (target.kind === "local") bridge = local;
  else {
    bridge = hosts.createRemoteBridge(target.endpoint, local, queryClient);
    if (local) {
      bridge = {
        ...bridge,
        appUpdates: local.appUpdates,
        ...(local.remoteAccess && { remoteAccess: local.remoteAccess }),
        openExternalUrl: local.openExternalUrl,
        ...(local.editorClipboard && { editorClipboard: local.editorClipboard }),
      };
    }
  }
  if (!bridge) throw new Error("The local host connection is unavailable.");
  if (local && bridge.notifications !== local.notifications) local.notifications.dispose();
  configureShellBridge(bridge);
  const connection = createShellConnection(bridge, queryClient, target.kind);
  leavePage = watchPage({
    ...bridge,
    // The release unmounts the app, then clears the client state, then closes the transport.
    dispose: () => releaseShellConnection(connection, () => root.unmount()),
  });
  // A remote host keeps its drafts in page memory, and the reload clears them. So only a local
  // draft can stop a host change.
  if (target.kind === "local") saveDrafts = () => connection.saveDrafts();
  const loadTheme = async () => {
    try {
      const snapshot = await loadSettingsSnapshotFromQuery(queryClient);
      applyThemeToDocument(resolveThemePreference(snapshot.theme, readSystemAppearance()));
    } catch (cause) {
      console.error(SETTINGS_PRELOAD_ERROR_MESSAGE, cause);
    }
  };
  if (target.kind === "local") await loadTheme();
  else void loadTheme();
  const mode = target.kind === "remote" ? "hash" : (options.routerMode ?? DEFAULT_ROUTER_MODE);
  root.render(
    <StrictMode>
      <StartupSplashLifecycle />
      <AppCrashShell kanbanLocation={kanbanLocationForRouter(mode)}>
        <ClientConnectionProvider connection={connection}>
          <ShellStateProvider remoteAccess={bridge.remoteAccess}>
            <HostConnectionProvider selection={selection} connection={bridge.remoteConnection}>
              <App routerMode={mode} />
            </HostConnectionProvider>
          </ShellStateProvider>
        </ClientConnectionProvider>
      </AppCrashShell>
    </StrictMode>,
  );
}
