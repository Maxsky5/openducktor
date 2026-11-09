import type { EmbeddedShortcutEvent, EmbeddedShortcutRules } from "@openducktor/contracts";
export type EmbeddedShortcutListener = (
  tabId: string | null,
  event: EmbeddedShortcutEvent,
  ready: boolean,
) => void;

export type EmbeddedShortcutSource = {
  tabId: string;
  apply(rules: EmbeddedShortcutRules): Promise<void>;
};
const sources = new Set<EmbeddedShortcutSource>();
const listeners = new Set<() => void>();
const inputListeners = new Set<
  (source: EmbeddedShortcutSource, event: EmbeddedShortcutEvent) => void
>();
let version = 0;
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};
export const embeddedShortcutSources = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  version: () => version,
  all: () => Array.from(sources),
  has: (source: EmbeddedShortcutSource) => sources.has(source),
  register(source: EmbeddedShortcutSource) {
    sources.add(source);
    changed();
    return () => {
      sources.delete(source);
      changed();
    };
  },
  report(source: EmbeddedShortcutSource, event: EmbeddedShortcutEvent) {
    if (sources.has(source)) for (const listener of inputListeners) listener(source, event);
  },
  listen(listener: (source: EmbeddedShortcutSource, event: EmbeddedShortcutEvent) => void) {
    inputListeners.add(listener);
    return () => {
      inputListeners.delete(listener);
    };
  },
};
