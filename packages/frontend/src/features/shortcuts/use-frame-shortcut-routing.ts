import type { ShortcutRoute, EmbeddedShortcutEvent } from "@openducktor/contracts";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  embeddedShortcutSources,
  type EmbeddedShortcutSource,
  type EmbeddedShortcutListener,
} from "./embedded-sources";

type Installation = {
  revision: number;
  routesKey: string;
  status: "pending" | "ready" | "failed";
  error: string | null;
};

/** Each preview document owns its acknowledged routes and failure state. */
export function useFrameShortcutRouting({
  retryRevision,
  routesVersion,
  readRoutes,
  onInput,
}: {
  retryRevision: number;
  routesVersion: object;
  readRoutes(tabId: string): ShortcutRoute[];
  onInput: EmbeddedShortcutListener;
}) {
  const sourcesVersion = useSyncExternalStore(
    embeddedShortcutSources.subscribe,
    embeddedShortcutSources.version,
    embeddedShortcutSources.version,
  );
  const control = useRef({
    alive: false,
    revision: 0,
    installations: new Map<EmbeddedShortcutSource, Installation>(),
  });
  const [states, setStates] = useState<ReadonlyMap<EmbeddedShortcutSource, Installation>>(
    new Map(),
  );
  const receive = useEffectEvent((source: EmbeddedShortcutSource, event: EmbeddedShortcutEvent) => {
    const owner = control.current;
    const state = owner.installations.get(source);
    if (!owner.alive || !embeddedShortcutSources.has(source)) return;
    const ready = state?.status === "ready";
    if (event.type === "invoke" && (!ready || state.revision !== event.revision)) return;
    onInput(source.tabId, event, ready);
  });
  useEffect(() => {
    const owner = control.current;
    owner.alive = true;
    const release = embeddedShortcutSources.listen(receive);
    return () => {
      owner.alive = false;
      owner.installations.clear();
      release();
    };
  }, []);
  const readRoutesRef = useRef(readRoutes);
  useLayoutEffect(() => {
    readRoutesRef.current = readRoutes;
  });
  const install = useCallback((force: boolean) => {
    const owner = control.current;
    const sources = embeddedShortcutSources.all();
    const currentSources = new Set(sources);
    let changed = false;
    for (const source of owner.installations.keys()) {
      if (currentSources.has(source)) continue;
      owner.installations.delete(source);
      changed = true;
    }
    for (const source of sources) {
      const routes = readRoutesRef.current(source.tabId);
      const routesKey = JSON.stringify(routes);
      const previous = owner.installations.get(source);
      if (!force && previous?.routesKey === routesKey) continue;
      const pending: Installation = {
        revision: ++owner.revision,
        routesKey,
        status: "pending",
        error: previous?.error ?? null,
      };
      owner.installations.set(source, pending);
      changed = true;
      const current = () =>
        owner.alive &&
        embeddedShortcutSources.has(source) &&
        owner.installations.get(source) === pending;
      void source.apply({ revision: pending.revision, routes }).then(
        () => {
          if (!current()) return;
          owner.installations.set(source, { ...pending, status: "ready", error: null });
          setStates(new Map(owner.installations));
        },
        (cause) => {
          if (!current()) return;
          const error = cause instanceof Error ? cause.message : String(cause);
          owner.installations.set(source, { ...pending, status: "failed", error });
          setStates(new Map(owner.installations));
          void source.apply({ revision: ++owner.revision, routes: [] }).catch(() => {});
        },
      );
    }
    if (changed) setStates(new Map(owner.installations));
  }, []);
  const lastRetry = useRef(retryRevision);
  useEffect(() => {
    const force = lastRetry.current !== retryRevision;
    lastRetry.current = retryRevision;
    install(force);
  }, [routesVersion, retryRevision, sourcesVersion, install]);
  return {
    isReady(tabId: string | null | undefined): boolean {
      if (!tabId) return true;
      const source = embeddedShortcutSources.all().find((entry) => entry.tabId === tabId);
      return Boolean(source && control.current.installations.get(source)?.status === "ready");
    },
    refresh: () => install(false),
    /** Changes whenever a source's installation state changes. */
    installations: states,
    error: Array.from(states.values()).find((state) => state.error)?.error ?? null,
  };
}
