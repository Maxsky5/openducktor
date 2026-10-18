import type { QueryClient } from "@tanstack/react-query";
import type { LocalHost } from "./lib/host-location";
import type { ShellBridge } from "./lib/shell-bridge";

const DEFAULT_ROOT_ID = "root";

export type OpenDucktorShellBootstrapOptions = {
  createShellBridge: () => ShellBridge;
  hosts: {
    localHost: LocalHost | null;
    defaultEndpoint?: string | undefined;
    createRemoteBridge: (
      endpoint: string,
      local: ShellBridge | undefined,
      queryClient: QueryClient,
    ) => ShellBridge;
    navigate?: () => Promise<void>;
  };
  prepare?: () => void | Promise<void>;
  rootElement?: HTMLElement | null | undefined;
  rootId?: string;
  routerMode?: "browser" | "hash";
};

const rootMissingMessage = (rootId: string): string =>
  `OpenDucktor bootstrap root element "#${rootId}" was not found. Ensure the shell HTML contains the root element.`;

const explicitNullRootMessage = (): string =>
  "OpenDucktor bootstrap rootElement was explicitly set to null. Omit rootElement to use the shell root lookup, or pass an HTMLElement.";

export const resolveRootElement = (
  options: OpenDucktorShellBootstrapOptions,
  getRootById: (rootId: string) => HTMLElement | null,
): HTMLElement => {
  const rootId = options.rootId ?? DEFAULT_ROOT_ID;
  if (options.rootElement === null) {
    throw new Error(explicitNullRootMessage());
  }

  const rootElement = options.rootElement ?? getRootById(rootId);

  if (!rootElement) {
    throw new Error(rootMissingMessage(rootId));
  }

  if (!(rootElement instanceof HTMLElement)) {
    throw new Error(`OpenDucktor bootstrap root element "#${rootId}" must be an HTMLElement.`);
  }

  return rootElement;
};
