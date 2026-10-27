import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";

export type StartupPresentation = {
  detailsOpen: boolean;
  expandedSteps: Set<string>;
  scrollTop: number;
  inspection: ReturnType<typeof createStartupInspection>;
  terminalScroll: Map<string, number>;
  terminalFollowBottom: Map<string, boolean>;
  terminalText: Map<string, string>;
  terminalTextScroll: Map<string, number>;
};

const presentations = new WeakMap<ClientConnection, Map<string, StartupPresentation>>();

export const startupPresentation = (
  connection: ClientConnection,
  attemptId: string,
): StartupPresentation => {
  let attempts = presentations.get(connection);
  if (!attempts) {
    attempts = new Map();
    presentations.set(connection, attempts);
  }
  let presentation = attempts.get(attemptId);
  if (!presentation) {
    presentation = {
      detailsOpen: false,
      expandedSteps: new Set(),
      scrollTop: 0,
      inspection: createStartupInspection(),
      terminalScroll: new Map(),
      terminalFollowBottom: new Map(),
      terminalText: new Map(),
      terminalTextScroll: new Map(),
    };
    attempts.set(attemptId, presentation);
  }
  return presentation;
};

export const retainStartupPresentations = (
  connection: ClientConnection,
  attemptIds: ReadonlySet<string>,
): void => {
  const attempts = presentations.get(connection);
  if (!attempts) return;
  for (const id of attempts.keys()) if (!attemptIds.has(id)) attempts.delete(id);
};

function createStartupInspection() {
  let expanded = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => expanded,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle: () => {
      expanded = !expanded;
      for (const listener of listeners) listener();
    },
  };
}
