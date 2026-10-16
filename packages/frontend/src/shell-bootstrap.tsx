import { RemoteConnectionBoundary } from "./components/layout/remote-connection-boundary";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppCrashShell } from "./components/errors/app-crash-shell";
import { applyThemeToDocument } from "./components/layout/theme-dom";
import { readSystemAppearance, resolveThemePreference } from "./components/layout/theme-preference";
import { appQueryClient } from "./lib/query-client";
import { configureShellBridge, getShellBridge, type ShellBridge } from "./lib/shell-bridge";
import {
  type OpenDucktorShellBootstrapOptions,
  runOpenDucktorShellBootstrap,
  resolveRootElement,
} from "./shell-bootstrap-workflow";
import { dismissOpenDucktorStartupSplash } from "./startup-splash/runtime";
import { loadSettingsSnapshotFromQuery } from "./state/queries/workspace";
import { HostConnectionProvider } from "./components/layout/host-connection";
import { HostConnectionPage } from "./components/layout/host-connection-page";
import { HostPicker } from "./components/layout/host-picker";
import { loadRecentItems } from "./features/command-palette/recent-items";
import {
  hostLocation,
  parseHostEndpoint,
  readHostTarget,
  saveHostTarget,
  type HostSelection,
  type HostTarget,
} from "./lib/host-location";

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

const renderOpenDucktorShellApp = (rootElement: HTMLElement, routerMode: ShellRouterMode): void => {
  createRoot(rootElement).render(
    <StrictMode>
      <StartupSplashLifecycle />
      <AppCrashShell kanbanLocation={kanbanLocationForRouter(routerMode)}>
        <RemoteConnectionBoundary connection={getShellBridge().remoteConnection}>
          <App routerMode={routerMode} />
        </RemoteConnectionBoundary>
      </AppCrashShell>
    </StrictMode>,
  );
};

export const bootstrapOpenDucktorShell = (
  options: OpenDucktorShellBootstrapOptions,
): Promise<void> =>
  options.hosts
    ? bootstrapHostClient(options, options.hosts)
    : runOpenDucktorShellBootstrap(options, {
        configureBridge,
        getRootById: (rootId) => document.getElementById(rootId),
        loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(appQueryClient),
        applyTheme: (preference) =>
          applyThemeToDocument(resolveThemePreference(preference, readSystemAppearance())),
        renderApp: (rootElement) =>
          renderOpenDucktorShellApp(rootElement, options.routerMode ?? DEFAULT_ROUTER_MODE),
        reportSettingsPreloadError: (error) => {
          console.error(SETTINGS_PRELOAD_ERROR_MESSAGE, error);
        },
      });

async function bootstrapHostClient(
  options: OpenDucktorShellBootstrapOptions,
  hosts: NonNullable<OpenDucktorShellBootstrapOptions["hosts"]>,
): Promise<void> {
  await options.prepare?.();
  const element = resolveRootElement(options, (id) => document.getElementById(id));
  const root = createRoot(element);
  // A cached page must not resume owners that an explicit host switch already released.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
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
  let bridge: ShellBridge | undefined;
  const move = async (next: HostTarget) => {
    if (target.kind === "local" && next.kind === "local") return;
    if (
      target.kind === "remote" &&
      next.kind === "remote" &&
      target.endpoint === parseHostEndpoint(next.endpoint, location.protocol)
    )
      return;
    saveHostTarget(next, location.protocol);
    const url = hostLocation(location, next);
    await appQueryClient.cancelQueries();
    await bridge?.dispose?.();
    bridge?.notifications.dispose();
    window.history.replaceState(null, "", url);
    if (hosts.navigate) await hosts.navigate();
    else window.location.reload();
  };
  const selection: HostSelection = {
    target,
    localHost: hosts.localHost,
    select: async (endpoint) => {
      if (endpoint === null && !localAvailable) throw new Error("This client has no local host.");
      await move(endpoint === null ? { kind: "local" } : { kind: "remote", endpoint });
    },
    disconnect: () => move({ kind: "picker" }),
  };
  applyThemeToDocument(resolveThemePreference("system", readSystemAppearance()));
  if (target.kind === "picker") {
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
  const local = localAvailable ? options.createShellBridge() : undefined;
  if (target.kind === "local") bridge = local;
  else {
    bridge = hosts.createRemoteBridge(target.endpoint, local);
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
  configureBridge(bridge);
  window.addEventListener("pagehide", () => bridge?.notifications.dispose(), { once: true });
  const loadTheme = async () => {
    try {
      const snapshot = await loadSettingsSnapshotFromQuery(appQueryClient);
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
        <HostConnectionProvider selection={selection} connection={bridge.remoteConnection}>
          <App routerMode={mode} />
        </HostConnectionProvider>
      </AppCrashShell>
    </StrictMode>,
  );
}

function configureBridge(bridge: ShellBridge): void {
  configureShellBridge(bridge);
  loadRecentItems();
}
