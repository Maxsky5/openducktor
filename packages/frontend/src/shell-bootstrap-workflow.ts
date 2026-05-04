import type { Theme } from "@openducktor/contracts";
import type { ShellBridge } from "./lib/shell-bridge";

const DEFAULT_ROOT_ID = "root";

export type OpenDucktorShellBootstrapOptions = {
  createShellBridge: () => ShellBridge;
  prepare?: () => void | Promise<void>;
  rootElement?: HTMLElement | null;
  rootId?: string;
};

export type ShellBootstrapDependencies = {
  configureBridge: (bridge: ShellBridge) => void;
  getRootById: (rootId: string) => HTMLElement | null;
  loadSettingsSnapshot: () => Promise<{ theme: Theme }>;
  applyTheme: (theme: Theme) => void;
  renderApp: (rootElement: HTMLElement) => void;
  reportSettingsPreloadError: (error: unknown) => void;
};

const rootMissingMessage = (rootId: string): string =>
  `OpenDucktor bootstrap root element "#${rootId}" was not found. Ensure the shell HTML contains the root element.`;

const resolveRootElement = (
  options: OpenDucktorShellBootstrapOptions,
  getRootById: ShellBootstrapDependencies["getRootById"],
): HTMLElement => {
  const rootId = options.rootId ?? DEFAULT_ROOT_ID;
  const rootElement = "rootElement" in options ? options.rootElement : getRootById(rootId);

  if (!rootElement) {
    throw new Error(rootMissingMessage(rootId));
  }

  if (!(rootElement instanceof HTMLElement)) {
    throw new Error(`OpenDucktor bootstrap root element "#${rootId}" must be an HTMLElement.`);
  }

  return rootElement;
};

export const runOpenDucktorShellBootstrap = async (
  options: OpenDucktorShellBootstrapOptions,
  dependencies: ShellBootstrapDependencies,
): Promise<void> => {
  await options.prepare?.();

  const rootElement = resolveRootElement(options, dependencies.getRootById);
  const bridge = options.createShellBridge();
  dependencies.configureBridge(bridge);

  try {
    const settingsSnapshot = await dependencies.loadSettingsSnapshot();
    dependencies.applyTheme(settingsSnapshot.theme);
  } catch (error) {
    dependencies.reportSettingsPreloadError(error);
  }

  dependencies.renderApp(rootElement);
};
